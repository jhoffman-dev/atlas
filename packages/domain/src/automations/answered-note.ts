/**
 * The notes a Claude step is handed (P29-03) and how much of each the model
 * is shown. What is shown is what a proposal may cite, so the prompt and the
 * check of an answer both cut a note here, the same way.
 */

import { importOutcomeOf } from '../meetings/meeting-arrival.ts';
import { isMeetingType } from '../meetings/meeting-header.ts';
import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/**
 * What the run knows of a note that is a meeting. It is read from the note's
 * own file by the run — never from the model's answer — so a proposal that
 * links back to "the meeting it came from" can only mean a meeting the run
 * was about.
 */
export interface AnsweredMeeting {
  /**
   * Which meeting it is (provider and id), once the import has let it in;
   * null for a meeting note the import does not vouch for — one written by
   * hand, or not yet stamped.
   */
  readonly identity: MeetingIdentity | null;
}

/** A note the run was about, as it was read: what a proposal may cite. */
export interface AnsweredNote {
  readonly path: VaultPath;
  readonly text: string;
  /** Set when the note is a meeting: it is cut by whole turns, and may be linked back to. */
  readonly meeting?: AnsweredMeeting;
}

/** A note the model was shown only the start of. */
export interface NoteCut {
  readonly path: VaultPath;
  /** How many characters of it the model was shown. */
  readonly shown: number;
  /** How many it has. */
  readonly of: number;
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

/**
 * What the run knows of a note with these properties as a meeting; undefined
 * when it is not one — read as linking reads it (`isMeetingType`). The
 * identity is the meeting's own keys, taken only from a note the import
 * stamped `imported`, and spelt as the meeting is found by them
 * (`sameMeetingIdentity`): the provider as written, the id without the spaces
 * round it.
 */
export function answeredMeetingOf(
  properties: Readonly<Record<string, unknown>>,
): AnsweredMeeting | undefined {
  if (!isMeetingType(properties['type'])) return undefined;
  const text = (key: string) => {
    const value = properties[key];
    return typeof value === 'string' ? value : '';
  };
  const [provider, externalId] = [text('provider'), text('external_id').trim()];
  const letIn =
    importOutcomeOf(properties) === 'imported' && provider.trim() !== '' && externalId !== '';
  return { identity: letIn ? { provider, externalId } : null };
}

/**
 * Each note as the model is shown it: whole, or cut — a meeting by whole
 * turns, any other note by whole lines where possible.
 */
export function shownNotes(notes: readonly AnsweredNote[]): AnsweredNote[] {
  const room = roomFor(notes);
  return notes.map((note) => ({ ...note, text: shownText(note, room) }));
}

/** The notes that were cut, and by how much: what a run's log says, so a longer note can be read in parts. */
export function cutNotes(notes: readonly AnsweredNote[]): NoteCut[] {
  const room = roomFor(notes);
  return notes.flatMap((note) =>
    note.text.length <= room
      ? []
      : [{ path: note.path, shown: shownStart(note, room).length, of: note.text.length }],
  );
}

function roomFor(notes: readonly AnsweredNote[]): number {
  return Math.min(
    CLAUDE_NOTE_CHARACTERS,
    Math.floor(CLAUDE_TOTAL_NOTE_CHARACTERS / Math.max(1, notes.length)),
  );
}

function shownText(note: AnsweredNote, room: number): string {
  return note.text.length <= room ? note.text : `${shownStart(note, room)}${CUT_MARK}`;
}

/** The start of a note too long to show whole. */
function shownStart({ text, meeting }: AnsweredNote, room: number): string {
  return meeting === undefined ? wholeLines(text, room) : wholeBlocks(text, room);
}

function wholeLines(text: string, room: number): string {
  const head = text.slice(0, room);
  const lineEnd = head.lastIndexOf('\n');
  const midLine = text.charAt(room) !== '\n';
  return midLine && lineEnd >= room - PARTIAL_LINE_REACH ? head.slice(0, lineEnd) : head;
}

/** A blank line, whichever way the file ends its lines: a provider's export may be CRLF. */
const BLANK_LINE = /\n[ \t\r]*\n/g;

/**
 * The paragraphs of `text` that end within `room`. A transcript's turn is a
 * paragraph ending in its id, however long: half a turn is words with no id
 * to cite, or an id with half its words, so a turn is shown whole or not at
 * all — even when that shows much less than the room allows.
 */
function wholeBlocks(text: string, room: number): string {
  let end = 0;
  for (const gap of text.matchAll(BLANK_LINE)) {
    if (gap.index > room) break;
    end = gap.index;
  }
  // Up to the blank line, less the CR a CRLF file leaves before it.
  return text.slice(0, end).replace(/\r$/, '');
}
