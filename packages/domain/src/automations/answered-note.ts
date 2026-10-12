/**
 * The notes a Claude step is handed (P29-03) and how much of each the model
 * is shown. What is shown is what a proposal may cite, so the prompt and the
 * check of an answer both cut a note here, the same way.
 */

import type { VaultPath } from '../vault/vault-path.ts';

/** A note the run was about, as it was read: what a proposal may cite. */
export interface AnsweredNote {
  readonly path: VaultPath;
  readonly text: string;
}

/** The most of one note a step is handed; past it, the note is cut and says so. */
export const CLAUDE_NOTE_CHARACTERS = 20_000;

/**
 * The most of all the notes together: the notes ride in the system prompt,
 * which the host passes as one command-line argument, so the whole of it
 * stays well inside what an argument may hold. Each note gets an equal share
 * when they would not all fit whole.
 */
export const CLAUDE_TOTAL_NOTE_CHARACTERS = 120_000;

const CUT_MARK = '\n… (cut)';

/** A partial last line is dropped when a line break is this close: half an id cites nothing real. */
const PARTIAL_LINE_REACH = 1_000;

/** Each note as the model is shown it: whole, or cut by whole lines where possible. */
export function shownNotes(notes: readonly AnsweredNote[]): AnsweredNote[] {
  const room = Math.min(
    CLAUDE_NOTE_CHARACTERS,
    Math.floor(CLAUDE_TOTAL_NOTE_CHARACTERS / Math.max(1, notes.length)),
  );
  return notes.map(({ path, text }) => ({ path, text: shownText(text, room) }));
}

function shownText(text: string, room: number): string {
  if (text.length <= room) return text;
  const head = text.slice(0, room);
  const lineEnd = head.lastIndexOf('\n');
  const midLine = text.charAt(room) !== '\n';
  const whole = midLine && lineEnd >= room - PARTIAL_LINE_REACH ? head.slice(0, lineEnd) : head;
  return `${whole}${CUT_MARK}`;
}
