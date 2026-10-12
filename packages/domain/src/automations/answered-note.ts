/**
 * The notes a Claude step is handed (P29-03) and how much of each the model
 * is shown. What is shown is what a proposal may cite, so the prompt and the
 * check of an answer both cut a note here, the same way.
 */

import { attendeesOf } from '../meeting-links/meeting-link-plan.ts';
import { importOutcomeOf } from '../meetings/meeting-arrival.ts';
import { isMeetingType, type MeetingAttendee } from '../meetings/meeting-header.ts';
import { unclosedFence } from '../meetings/meeting-lines.ts';
import { meetingSectionBounds, meetingTurnsOf } from '../meetings/meeting-turns.ts';
import { truncated } from './answer-limits.ts';
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
  /** The day it was held (`YYYY-MM-DD`), when its frontmatter says: what a due date is judged near. */
  readonly date?: string;
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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text('date').trim()) ? text('date').trim() : undefined;
  return {
    identity: letIn ? { provider, externalId } : null,
    attendees: attendeesOf(properties),
    ...(date !== undefined && { date }),
  };
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
  /** The notes no ask is made about, and why: there was nothing in them to cite. */
  readonly skipped: readonly NoteSkipped[];
}

/** A note a run did not ask about. */
export interface NoteSkipped {
  readonly path: VaultPath;
  readonly reason: string;
}

/**
 * The asks a run makes about `notes`. Ordinarily one, about all of them, each
 * cut to its share. With `inParts` (an output that reads meetings turn by
 * turn, P29-05) every note is asked about alone — unless it has no transcript
 * turn to cite, which costs an ask for nothing and is skipped, with why — and
 * a meeting too long for one ask is read in parts: each its frontmatter and
 * the sections before its transcript (the notes trimmed to fit), then as many
 * whole turns as fit, after the last two turns of the part before, quoted for
 * context and not citable — up to {@link CLAUDE_ASKS_PER_RUN} asks a run.
 * Past that the rest of a meeting is not read, and is reported as cut.
 */
export function claudeAsks(
  notes: readonly AnsweredNote[],
  { inParts }: { inParts: boolean },
): ClaudeAsks {
  if (!inParts) return { asks: [notes], cut: cutNotes(notes), skipped: [] };
  const skipped = notes
    .filter((note) => meetingTurnsOf(note.text).length === 0)
    .map(skippedWithout);
  const read = notes.filter((note) => !skipped.some(({ path }) => path === note.path));
  let spare = Math.max(0, CLAUDE_ASKS_PER_RUN - read.length);
  const asks: AnsweredNote[][] = [];
  const cut: NoteCut[] = [];
  for (const note of read) {
    const { parts, head, unfit } = meetingParts(note, CLAUDE_NOTE_CHARACTERS);
    const taken = parts.slice(0, 1 + spare);
    spare -= taken.length - 1;
    asks.push(...taken.map((part) => [{ ...note, text: part.text }]));
    const characters = head + taken.reduce((sum, part) => sum + part.read, 0);
    if (taken.length < parts.length || unfit) {
      cut.push({ path: note.path, shown: characters, of: note.text.length });
    }
  }
  return { asks, cut, skipped };
}

function skippedWithout(note: AnsweredNote): NoteSkipped {
  return {
    path: note.path,
    reason: 'It has no transcript turn for Claude to cite, so Claude was not asked about it.',
  };
}

/** One part of a note as an ask shows it, and how many of the note's own characters it holds past the head. */
interface NotePart {
  readonly text: string;
  readonly read: number;
}

interface NoteParts {
  readonly parts: NotePart[];
  readonly head: number;
  readonly unfit: boolean;
}

/**
 * A note as the parts it is read in. A note that fits, or is no meeting, or
 * whose transcript cannot be found, is one part — cut, when too long, as
 * {@link shownNotes} cuts it. A long meeting is its head (everything up to
 * and including its `## Transcript` heading, found as the import's contract
 * finds it, with its Notes trimmed when the head would crowd out the turns)
 * before each run of whole turns that fits; a turn too long to fit with the
 * head is in no part.
 */
function meetingParts(note: AnsweredNote, room: number): NoteParts {
  const whole = (): NoteParts => {
    const fits = note.text.length <= room;
    const read = fits ? note.text.length : shownStart(note, room).length;
    return { parts: [{ text: note.text, read }], head: 0, unfit: !fits };
  };
  if (note.meeting === undefined || note.text.length <= room) return whole();
  const head = headOf(note.text, room / 2);
  if (head === null) return whole();
  const turns = note.text
    .slice(head.end)
    .split(TURN_GAP)
    .map((turn) => turn.replace(/^[\r\n]+|[\r\n]+$/g, ''))
    .filter((turn) => turn.trim() !== '');
  const runs = runsThatFit(turns, room - head.text.length - PART_MARK_ROOM - CONTEXT_ROOM);
  if (runs.runs.length === 0) return whole();
  const parts = runs.runs.map((run, at) => ({
    text: partText({ head: head.text, run, before: runs.runs[at - 1], at, of: runs.runs.length }),
    read: run.reduce((sum, turn) => sum + turn.length, 0),
  }));
  return { parts, head: head.text.length, unfit: runs.unfit };
}

/**
 * A meeting's head: its text up to and including the Transcript heading's
 * line, no longer than `budget` — the Notes cut at a line and any code fence
 * they opened closed, so what follows is not read as code. Null when the
 * transcript cannot be found, or the head cannot be made to fit.
 */
function headOf(text: string, budget: number): { text: string; end: number } | null {
  const sections = meetingSectionBounds(text);
  const transcript = sections.find((section) => section.name === 'transcript');
  if (transcript === undefined) return null;
  const end = Math.max(transcript.headingStart, transcript.textStart - 1);
  const headText = text.slice(0, end);
  if (headText.length <= budget) return { text: headText, end: transcript.textStart - 1 };
  const notes = sections.find((section) => section.name === 'notes');
  if (notes === undefined) return null;
  const rest = text.slice(notes.textEnd, end);
  const before = text.slice(0, notes.textStart);
  const room = budget - before.length - rest.length - NOTES_CUT_ROOM;
  if (room <= 0) return null;
  const kept = wholeLines(text.slice(notes.textStart, notes.textEnd), room);
  const fence = unclosedFence(kept);
  const closed = fence === null ? kept : `${kept.replace(/\n+$/, '')}\n${fence}`;
  return { text: `${before}${closed}\n… (notes cut)\n\n${rest}`, end: transcript.textStart - 1 };
}

/** Room kept in a head for the line saying its Notes were cut, and a fence closed. */
const NOTES_CUT_ROOM = 100;

/** Room kept in each later part for the turns before it, quoted. */
const CONTEXT_ROOM = 1_000;

/** How many of the part before's last turns a part quotes. */
const CONTEXT_TURNS = 2;

/** The last turns of the part before, quoted so they read as no turn and carry no id that could be cited. */
function contextOf(before: readonly string[] | undefined): string {
  if (before === undefined) return '';
  const quoted = before
    .slice(-CONTEXT_TURNS)
    .map((turn) => turn.replace(/[ \t]*\^[A-Za-z0-9-]+[ \t]*$/, ''))
    .map((turn) =>
      turn
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    );
  return truncated(quoted.join('\n>\n'), CONTEXT_ROOM - 100);
}

function partText({
  head,
  run,
  before,
  at,
  of,
}: {
  head: string;
  run: readonly string[];
  before: readonly string[] | undefined;
  at: number;
  of: number;
}): string {
  const context = contextOf(before);
  const earlier = context === '' ? '' : `\n\n${CONTEXT_MARK}\n\n${context}`;
  return `${head}\n\n${partMark(at, of)}${earlier}\n\n${run.join('\n\n')}\n`;
}

const CONTEXT_MARK =
  '(The end of the part before, quoted for context only. It has no ids and cannot be cited.)';

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
