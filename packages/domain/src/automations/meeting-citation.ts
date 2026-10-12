/**
 * How an output that reads a meeting turn by turn cites it (P29-05, P29-06):
 * an item names the id of one transcript turn, and the run resolves it against
 * the one meeting it was shown. Shared by every such output, so "which turn"
 * and "which meeting" are decided in one place.
 */

import { splitFrontmatter } from '../markdown/markdown-document.ts';
import { wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { meetingTurnsOf } from '../meetings/meeting-turns.ts';
import type { TranscriptTurn } from '../meetings/transcript.ts';
import { digestOf } from '../sources/merge.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { truncated } from './answer-limits.ts';
import { shownNotes, type AnsweredNote } from './answered-note.ts';
import { citedBlockProblem, namesNote, type AnswerContext } from './proposal-schema.ts';

/** The turn an item cites, in a meeting the model was shown — or why it cites none. */
export type CitedMeetingTurn =
  | {
      readonly ok: true;
      readonly meeting: AnsweredNote;
      readonly turn: TranscriptTurn;
      /** The citation as a link the shared check reads: `[[Meeting#^t0004]]`. */
      readonly source: string;
    }
  | { readonly ok: false; readonly reason: string };

const BARE_ID = /^\^?([A-Za-z0-9-]+)$/;

/** What a `source_block` names: a turn's id, and the meeting when it was written as a link. */
function writtenCitation(sourceBlock: string): { id: string; target: string | null } | null {
  const written = sourceBlock.trim();
  const bare = BARE_ID.exec(written);
  if (bare !== null) return { id: bare[1]!, target: null };
  const link = readWikiLink(written);
  if (link === null || link.embed || !link.heading?.startsWith('#^')) return null;
  const id = link.heading.slice(2);
  return id === '' ? null : { id, target: link.target };
}

/**
 * The transcript turn an item's `source_block` is: an id (`t0004`) of a turn
 * of the one meeting this answer is about. Only a turn of the Transcript
 * counts: a block of the summary or of the provider's next steps is not what
 * was said.
 *
 * One meeting, never several: which meeting an accepted task is linked back
 * to follows from the turn it cites, so an answer about two meetings could
 * file one's task under the other — and two notes of one title could not be
 * told apart at all. A run asks about each meeting alone (`readsInParts`); an
 * answer checked against more than one note has every item left out.
 */
export function citedMeetingTurn(sourceBlock: string, context: AnswerContext): CitedMeetingTurn {
  const cited = writtenCitation(sourceBlock);
  if (cited === null) {
    return unfound(`Its source_block ${quoted(sourceBlock)} is not the id of a turn.`);
  }
  const [meeting, ...others] = shownNotes(context.notes);
  if (others.length > 0) return unfound('This output reads one meeting at a time.');
  if (meeting?.meeting === undefined) return unfound('This run read no meeting to cite a turn of.');
  const from = noteTitle(meeting.path);
  if (cited.target !== null && !namesNote(cited.target, meeting.path)) {
    return unfound(`It cites ${quoted(cited.target)}, which is not the meeting it was taken from.`);
  }
  const turn = meetingTurnsOf(meeting.text).find((each) => each.blockId === cited.id);
  if (turn === undefined) {
    return unfound(
      `${from} has no transcript turn ^${truncated(cited.id, 40)} that Claude was shown.`,
    );
  }
  const source = `[[${meetingLinkTarget(meeting, context)}#^${cited.id}]]`;
  // The shared check reads it again, its own way (outside a code fence): what it would refuse is left out here.
  const problem = citedBlockProblem(source, context.notes);
  return problem === null ? { ok: true, meeting, turn, source } : unfound(problem);
}

const unfound = (reason: string): CitedMeetingTurn => ({ ok: false, reason });
const quoted = (text: string): string => JSON.stringify(truncated(text, 80));

/** What a link to the meeting is written as: spelt against the vault's notes when the run knows them. */
export function meetingLinkTarget(meeting: AnsweredNote, { vault }: AnswerContext): string {
  return vault === undefined
    ? noteTitle(meeting.path)
    : wikiLinkTargetFor(meeting.path, vault.notePaths);
}

/**
 * What a meeting is, to a rule that has answered it: the words, not the
 * frontmatter. Accepting a proposal writes the meeting's `tasks` or
 * `decisions`; that is Atlas's change, not something said in the meeting, and
 * must not make the meeting new.
 */
export function meetingWordsKey({ text, meeting }: Pick<AnsweredNote, 'text' | 'meeting'>): string | null {
  const identity = meeting?.identity;
  // Keys match across paths: only a meeting the import vouches for is unique enough to name.
  if (identity === null || identity === undefined) return null;
  return `meeting:${identity.provider}:${identity.externalId}:body:${digestOf(splitFrontmatter(text).body)}`;
}
