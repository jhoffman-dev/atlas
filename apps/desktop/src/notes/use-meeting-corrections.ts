import { useCallback, useMemo, useState } from 'react';
import { recordedCorrections, type VaultPath } from '@atlas/domain';
import {
  CorrectionRefusedError,
  NoteChangedError,
  undoMeetingTermCorrections,
  UnsavedTypingError,
  type ActivityLog,
  type MarkdownPort,
  type OpenNotes,
  type VaultFsPort,
} from '@atlas/application';
import type { CorrectionsNotice } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import { errorMessage } from '../query/error-message.ts';

/** What Undo corrections refuses rather than fails at: shown on the band, and no fault to record. */
const UNDO_REFUSALS = [CorrectionRefusedError, UnsavedTypingError, NoteChangedError];

/**
 * The corrections band of the meeting in a pane (P28-06): what the import
 * corrected, read from the note's frontmatter, and its Undo. The pane's
 * typing is written first, so a meeting edited since it was corrected is
 * refused as the file says, never as it was when the pane opened it.
 */
export function useMeetingCorrections({
  fs,
  markdown,
  openNotes,
  flush,
  path,
  properties,
  onChanged,
  activity,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: Pick<OpenNotes, 'state' | 'reload'>;
  /** Writes the pane's unsaved typing, settling once it has landed or been refused. */
  flush: () => Promise<void>;
  path: VaultPath | null;
  /** The open note's frontmatter; null while none is open. */
  properties: Readonly<Record<string, unknown>> | null;
  /** Re-reads the tree and the index, after the undo wrote. */
  onChanged: () => void;
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): CorrectionsNotice | undefined {
  // Kept with the note it is about, so a refusal is never shown over another.
  const [refusal, setRefusal] = useState<{ path: VaultPath; reason: string } | null>(null);
  const [undoing, setUndoing] = useState<VaultPath | null>(null);

  const undo = useCallback(
    async (at: VaultPath) => {
      const named = { activity, write: 'corrections', path: at, refusal: UNDO_REFUSALS } as const;
      setUndoing(at);
      try {
        await flush();
        await withGiveUpRecorded(named, () =>
          undoMeetingTermCorrections({ ports: { fs, markdown, editors: openNotes }, path: at }),
        );
        setRefusal(null);
        onChanged();
      } catch (error) {
        setRefusal({ path: at, reason: errorMessage(error) });
      } finally {
        setUndoing(null);
      }
    },
    [fs, markdown, openNotes, flush, onChanged, activity],
  );

  const records = useMemo(
    () => (properties === null ? null : recordedCorrections(properties)),
    [properties],
  );
  if (path === null || records === null) return undefined;
  return {
    spellings: records.map(({ from, to, count }) => ({ from, to, count })),
    onUndo: () => void undo(path),
    refusal: refusal?.path === path ? refusal.reason : null,
    undoing: undoing === path,
  };
}
