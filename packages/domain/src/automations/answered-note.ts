/**
 * The notes a Claude step is handed (P29-03) and how much of each the model
 * is shown. What is shown is what a proposal may cite, so the prompt and the
 * check of an answer both cut a note here, the same way.
 */

import { attendeesOf } from '../meeting-links/meeting-link-plan.ts';
import { importOutcomeOf } from '../meetings/meeting-arrival.ts';
import { isMeetingType, type MeetingAttendee } from '../meetings/meeting-header.ts';
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
  /** Who its frontmatter lists as there: who an item taken from it may be owned by (P29-05). */
  readonly attendees?: readonly MeetingAttendee[];
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
 * when it is not one. The identity is the meeting's own keys, taken only from
 * a note the import stamped `imported`.
 */
export function answeredMeetingOf(
  properties: Readonly<Record<string, unknown>>,
): AnsweredMeeting | undefined {
  if (!isMeetingType(properties['type'])) return undefined;
  const text = (key: string) => {
    const value = properties[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const [provider, externalId] = [text('provider'), text('external_id')];
  const letIn = importOutcomeOf(properties) === 'imported' && provider !== '' && externalId !== '';
  return { identity: letIn ? { provider, externalId } : null, attendees: attendeesOf(properties) };
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

const BLANK_LINE = /\n[ \t]*\n/g;

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
  return text.slice(0, end);
}

/**
 * The most asks one run makes when its output reads a long meeting in parts
 * (P29-05): as many as the notes one Claude run may read, so a run costs no
 * more asks than it could already have notes. Every note gets one; the rest
 * go to the parts of long meetings, in the order the notes came.
 */
export const CLAUDE_ASKS_PER_RUN = 10;

/** What a run asks the model: each ask's notes as it is shown them, and what no ask shows. */
export interface ClaudeAsks {
  readonly asks: readonly (readonly AnsweredNote[])[];
  /** The notes some of which no ask shows. */
  readonly cut: readonly NoteCut[];
}

/**
 * The asks a run makes about `notes`. Ordinarily one, about all of them, each
 * cut to its share. With `inParts` (an output that reads meetings turn by
 * turn, P29-05) every note is asked about alone, and a meeting too long for
 * one ask is read in parts — each its frontmatter and the sections before its
 * transcript, then as many whole turns as fit — up to
 * {@link CLAUDE_ASKS_PER_RUN} asks a run. Past that the rest of a meeting is
 * not read, and is reported as cut.
 */
export function claudeAsks(
  notes: readonly AnsweredNote[],
  { inParts }: { inParts: boolean },
): ClaudeAsks {
  if (!inParts) return { asks: [notes], cut: cutNotes(notes) };
  let spare = Math.max(0, CLAUDE_ASKS_PER_RUN - notes.length);
  const asks: AnsweredNote[][] = [];
  const cut: NoteCut[] = [];
  for (const note of notes) {
    const { parts, head, unfit } = meetingParts(note, CLAUDE_NOTE_CHARACTERS);
    const taken = parts.slice(0, 1 + spare);
    spare -= taken.length - 1;
    asks.push(...taken.map((part) => [{ ...note, text: part.text }]));
    const read = head + taken.reduce((sum, part) => sum + part.read, 0);
    if (taken.length < parts.length || unfit) {
      cut.push({ path: note.path, shown: read, of: note.text.length });
    }
  }
  return { asks, cut };
}

/** One part of a note as an ask shows it, and how many of the note's own characters it holds past the head. */
interface NotePart {
  readonly text: string;
  readonly read: number;
}

/** A turn's heading, at the start of a line: where a meeting's head ends. */
const TRANSCRIPT_HEADING = /^##[ \t]+Transcript\b[^\n]*$/im;

/**
 * A note as the parts it is read in. A note that fits, or is no meeting, or
 * whose transcript cannot be found, is one part — cut, when too long, as
 * {@link shownNotes} cuts it. A long meeting is its head (everything up to
 * and including its `## Transcript` heading) before each run of whole
 * turns that fits; a turn too long to fit with the head is in no part.
 */
function meetingParts(
  note: AnsweredNote,
  room: number,
): { parts: NotePart[]; head: number; unfit: boolean } {
  const whole = (): { parts: NotePart[]; head: number; unfit: boolean } => {
    const fits = note.text.length <= room;
    const read = fits ? note.text.length : shownStart(note, room).length;
    return { parts: [{ text: note.text, read }], head: 0, unfit: !fits };
  };
  if (note.meeting === undefined || note.text.length <= room) return whole();
  const heading = TRANSCRIPT_HEADING.exec(note.text);
  const headEnd = heading === null ? -1 : heading.index + heading[0].length;
  // A head that leaves little room for turns is a note to cut, not one to read in parts.
  if (headEnd === -1 || headEnd > room / 2) return whole();
  const head = note.text.slice(0, headEnd);
  const turns = note.text
    .slice(headEnd)
    .split(TURN_GAP)
    .map((turn) => turn.replace(/^[\r\n]+|[\r\n]+$/g, ''))
    .filter((turn) => turn.trim() !== '');
  const runs = runsThatFit(turns, room - head.length - PART_MARK_ROOM);
  if (runs.runs.length === 0) return whole();
  const parts = runs.runs.map((run, at) => ({
    text: `${head}\n\n${partMark(at, runs.runs.length)}\n\n${run.join('\n\n')}\n`,
    read: run.reduce((sum, turn) => sum + turn.length, 0),
  }));
  return { parts, head: head.length, unfit: runs.unfit };
}

/** The blank line between two turns, as either kind of line ending writes it. */
const TURN_GAP = /\r?\n[ \t]*\r?\n/;

/** Room kept in each part for the line saying which part it is. */
const PART_MARK_ROOM = 200;

/** Said between a part's head and its turns, so no part is taken for the whole meeting. */
function partMark(at: number, of: number): string {
  return `(Part ${at + 1} of ${of} of this transcript. The turns before and after it are not shown in this ask.)`;
}

/** `turns` in order, as runs each no longer than `room`; `unfit` when a turn alone is longer and so is in none. */
function runsThatFit(turns: readonly string[], room: number): { runs: string[][]; unfit: boolean } {
  const runs: string[][] = [];
  let run: string[] = [];
  let size = 0;
  let unfit = false;
  for (const turn of turns) {
    if (turn.length > room) {
      unfit = true;
      continue;
    }
    if (run.length > 0 && size + turn.length + 2 > room) {
      runs.push(run);
      [run, size] = [[], 0];
    }
    run.push(turn);
    size += turn.length + 2;
  }
  if (run.length > 0) runs.push(run);
  return { runs, unfit };
}
