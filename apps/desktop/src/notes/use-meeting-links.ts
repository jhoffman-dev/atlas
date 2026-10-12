import { useCallback, useMemo, useState } from 'react';
import {
  isMeetingType,
  linksUndone,
  linkTargets,
  recordedLinks,
  wasLinked,
  type VaultPath,
} from '@atlas/domain';
import {
  CorrectionRefusedError,
  LinkUndoRefusedError,
  NoteChangedError,
  recorrectMeetingTerms,
  undoMeetingLinks,
  UnsavedTypingError,
  type ActivityLog,
  type IndexPort,
  type MarkdownPort,
  type OpenNotes,
  type VaultFsPort,
} from '@atlas/application';
import type { LinksNotice } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import { errorMessage } from '../query/error-message.ts';

/** What either command refuses rather than fails at: shown on the band, and no fault to record. */
const REFUSALS = [
  LinkUndoRefusedError,
  CorrectionRefusedError,
  UnsavedTypingError,
  NoteChangedError,
];

/** The name a link is shown by: the note it opens, as `[[Folder/Name|Shown]]` names it. */
const linkedName = (link: string): string => {
  const [target] = linkTargets(link);
  if (target === undefined) return link;
  const note = target.replace(/#.*$/, '');
  return note.slice(note.lastIndexOf('/') + 1).replace(/\.md$/i, '');
};

/**
 * The band of a linked meeting in a pane (P29-06): who linking added and how
 * many proposals it wrote, read from the record in the note's frontmatter,
 * with Undo links and Correct again. The pane's typing is written first, so
 * each command acts on the file as it is, never as it was when the pane opened
 * it. Both are the person's alone: nothing links a meeting again once its
 * links were undone, and nothing but Correct again corrects a meeting twice.
 */
export function useMeetingLinks({
  fs,
  markdown,
  index,
  openNotes,
  flush,
  path,
  properties,
  today,
  onChanged,
  activity,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  /** Where the vocabulary a meeting is corrected again by is read from. */
  index: Pick<IndexPort, 'query'>;
  openNotes: Pick<OpenNotes, 'state' | 'reload'>;
  /** Writes the pane's unsaved typing, settling once it has landed or been refused. */
  flush: () => Promise<void>;
  path: VaultPath | null;
  /** The open note's frontmatter; null while none is open. */
  properties: Readonly<Record<string, unknown>> | null;
  /** `YYYY-MM-DD`, as it is when a command is asked for. */
  today: () => string;
  /** Re-reads the tree and the index, after a command wrote. */
  onChanged: () => void;
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): LinksNotice | undefined {
  // Kept with the note it is about, so one meeting's answer is never shown over another.
  const [said, setSaid] = useState<{ path: VaultPath; text: string; refused: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<VaultPath | null>(null);

  const carryOut = useCallback(
    async (at: VaultPath, write: 'links' | 'recorrection', work: () => Promise<string>) => {
      setBusy(at);
      try {
        await flush();
        const text = await withGiveUpRecorded(
          { activity, write, path: at, refusal: REFUSALS },
          work,
        );
        setSaid({ path: at, text, refused: false });
        onChanged();
      } catch (error) {
        setSaid({ path: at, text: errorMessage(error), refused: true });
      } finally {
        setBusy(null);
      }
    },
    [flush, onChanged, activity],
  );

  const undo = useCallback(
    (at: VaultPath) =>
      carryOut(at, 'links', async () => {
        const ports = { fs, markdown, editors: openNotes };
        const undone = await undoMeetingLinks({ ports, path: at, today: today() });
        return undoneWords(undone.removed, undone.withdrawn.length, undone.left.length);
      }),
    [carryOut, fs, markdown, index, openNotes, today],
  );
  const correctAgain = useCallback(
    (at: VaultPath) =>
      carryOut(at, 'recorrection', async () => {
        const ports = { fs, markdown, index, editors: openNotes };
        const { count } = await recorrectMeetingTerms({ ports, path: at });
        return count === 0
          ? 'Corrected again: no misheard spelling is left in it.'
          : `Corrected again: ${count === 1 ? '1 spelling' : `${count} spellings`} put right. Undo corrections puts the words back.`;
      }),
    [carryOut, fs, markdown, index, openNotes],
  );

  const record = useMemo(
    () => (properties === null ? null : recordedLinks(properties)),
    [properties],
  );
  // Every meeting has the band: one never linked — made by hand, or imported before linking
  // kept a record — still needs Correct again, which is the only place it is offered.
  if (path === null || properties === null || !isMeetingType(properties['type'])) return undefined;
  const mine = said?.path === path ? said : null;
  return {
    linked: (record?.links ?? []).flatMap(({ added }) => added.map(linkedName)),
    proposals: record?.proposals.length ?? 0,
    undone: linksUndone(properties),
    linkedYet: wasLinked(properties),
    canUndo: record !== null,
    onUndo: () => void undo(path),
    onCorrectAgain: () => void correctAgain(path),
    said: mine === null ? null : { text: mine.text, refused: mine.refused },
    busy: busy === path,
  };
}

/** What Undo links says it did. */
function undoneWords(removed: number, withdrawn: number, left: number): string {
  const links = `${removed} ${removed === 1 ? 'link' : 'links'}`;
  const proposals =
    withdrawn === 0 ? '' : ` and ${withdrawn} open ${withdrawn === 1 ? 'proposal' : 'proposals'}`;
  const kept =
    left === 0
      ? ''
      : ` ${left} ${left === 1 ? 'proposal was' : 'proposals were'} answered already and left.`;
  return `Took back ${links}${proposals}.${kept}`;
}
