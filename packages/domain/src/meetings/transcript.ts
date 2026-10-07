import { bodyError, type MeetingImportError } from './meeting-import-error.ts';
import type { TranscriptClock } from './meeting-header.ts';
import { lineBlocks, withoutBlockId, type LineBlock } from './meeting-lines.ts';

/**
 * Who spoke a turn. `You` is the vault's owner, named by their profile when
 * it has a name (ADR-0024); anyone the provider could not name is unknown,
 * and is never guessed into a Person.
 */
export type TurnSpeaker =
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'self'; readonly name: string | null }
  | { readonly kind: 'unknown' };

/**
 * When a turn was spoken: its own time, the time of the section it fell
 * under (written `[~00:09:44]`, approximate), or none.
 */
export type TurnTime =
  | { readonly kind: 'turn' | 'section'; readonly text: string; readonly seconds: number }
  | { readonly kind: 'none' };

/** One speaker turn: one block of the Transcript section. */
export interface TranscriptTurn {
  readonly speaker: TurnSpeaker;
  /** The speaker as the file writes it, between the `**`. */
  readonly writtenSpeaker: string;
  readonly time: TurnTime;
  readonly words: string;
  /** Its `^id`, what a citation links to; null when the file left it off. */
  readonly blockId: string | null;
  /** The file line the turn starts on. */
  readonly line: number;
}

export interface ParsedTranscript {
  readonly turns: readonly TranscriptTurn[];
  readonly errors: readonly MeetingImportError[];
}

const FIELD = 'Transcript';

/** `**Speaker**` at the start of a line. Linear: the speaker cannot hold a `*`. */
const SPEAKER = /^\*\*([^*\n]+)\*\*/;
/**
 * A bracket that starts like a time — `[`, then perhaps `~`, `-` or spaces,
 * then a digit or a colon — and holds nothing but time-like characters. Right after the
 * speaker, it is the turn's time and must be a valid one: never words.
 */
const TIME_SHAPED = /^\[[~ \t-]*[\d:][\d:.~ \t-]*\]/;
const TIME = /^\[(~?)(\d{2,}):([0-5]\d):([0-5]\d)\]$/;
/** A block id inside a turn's words, not at their end. */
const INNER_ID = /(?:^|\s)(\^[A-Za-z0-9-]+)(?=\s|$)/;
const TURN_ID = /^t(\d+)$/;
const SELF = /^you$/i;
/** What providers call someone they could not name: `Remote Speaker 2`, `Speaker A`. */
const UNNAMED =
  /^(?:(?:unknown|remote)(?: speaker)?|speaker|guest|participant)(?: (?:\d+|[a-z]))?$/i;

function speakerOf(written: string, selfName: string | null): TurnSpeaker {
  if (SELF.test(written)) return { kind: 'self', name: selfName };
  if (UNNAMED.test(written)) return { kind: 'unknown' };
  return { kind: 'named', name: written };
}

interface TranscriptOptions {
  readonly selfName: string | null;
  /** The file line the section's text starts on. */
  readonly firstLine: number;
  /** What the times count (`transcript_clock`); `elapsed` when not given. */
  readonly clock?: TranscriptClock;
}

/** A time bracket read, or why it is not a time. */
function timeOf(bracket: string, clock: TranscriptClock): TurnTime | string {
  const match = TIME.exec(bracket);
  if (match === null) return `${bracket} is not a time like 00:09:44`;
  const [hours, minutes, seconds] = [Number(match[2]), Number(match[3]), Number(match[4])];
  if (clock === 'wall' && (hours > 23 || match[2]?.length !== 2)) {
    return `${bracket} is not a time of day, and transcript_clock is wall`;
  }
  const text = bracket.slice(match[1] === '~' ? 2 : 1, -1);
  const kind = match[1] === '~' ? 'section' : 'turn';
  return { kind, text, seconds: hours * 3600 + minutes * 60 + seconds };
}

/** The time a turn opens with, if any, and the words after it; or why they are wrong. */
function readTimeAndWords(
  after: string,
  clock: TranscriptClock,
): { readonly time: TurnTime; readonly words: string; readonly problems: readonly string[] } {
  const bracket = TIME_SHAPED.exec(after)?.[0];
  if (bracket === undefined) return { time: { kind: 'none' }, words: after, problems: [] };
  const time = timeOf(bracket, clock);
  const words = after.slice(bracket.length);
  const problems = typeof time === 'string' ? [time] : [];
  if (words.trim() === '') problems.push(`the turn has a time and no words`);
  else if (!/^[ \t]/.test(words)) problems.push(`write a space between ${bracket} and the words`);
  return { time: typeof time === 'string' ? { kind: 'none' } : time, words, problems };
}

/** Problems with the lines of a turn after the first: a turn run into it, an id inside it. */
function bodyProblems(block: LineBlock, words: string): string[] {
  const problems = block.text
    .split('\n')
    .slice(1)
    .flatMap((text, index) =>
      SPEAKER.test(text)
        ? [`line ${block.line + index + 1} starts another turn: put a blank line before it`]
        : [],
    );
  const inner = INNER_ID.exec(words)?.[1];
  if (inner !== undefined) {
    problems.push(
      `${inner} is inside the turn: an id ends its turn, and each turn is its own paragraph`,
    );
  }
  return problems;
}

interface TurnReading {
  readonly turn: TranscriptTurn | null;
  readonly errors: readonly MeetingImportError[];
}

function readTurn(
  block: LineBlock,
  { selfName, clock }: Required<Omit<TranscriptOptions, 'firstLine'>>,
): TurnReading {
  const { rest, blockId } = withoutBlockId(block.text);
  const head = SPEAKER.exec(rest);
  const speaker = head?.[1] ?? '';
  const after = rest.slice(head?.[0].length ?? 0).trimEnd();
  const turnError = (message: string) =>
    bodyError(FIELD, `Line ${block.line}: ${message}`, block.line);
  if (head === null || speaker.trim() !== speaker || !/^[ \t]+\S/.test(after)) {
    const message = `Line ${block.line} is not a turn: write \`**Speaker** [hh:mm:ss] words ^t0001\``;
    return { turn: null, errors: [bodyError(FIELD, message, block.line)] };
  }
  const { time, words, problems } = readTimeAndWords(after.replace(/^[ \t]+/, ''), clock);
  const errors = [...problems, ...bodyProblems(block, words)].map(turnError);
  if (blockId === null)
    errors.push(turnError('the turn has no block id — end it with ^t0001 and so on'));
  const turn: TranscriptTurn = {
    speaker: speakerOf(speaker, selfName),
    writtenSpeaker: speaker,
    time,
    words: words.trim(),
    blockId,
    line: block.line,
  };
  return { turn, errors };
}

/**
 * An error for every turn id that is not `t` and a number, is used twice, or
 * does not come after the one before it: `^t0001`, `^t0002`, … in order.
 */
function turnIdErrors(turns: readonly TranscriptTurn[]): MeetingImportError[] {
  const firstLine = new Map<string, number>();
  const errors: MeetingImportError[] = [];
  let previous = -1;
  for (const { blockId, line } of turns) {
    if (blockId === null) continue;
    const say = (message: string) =>
      errors.push(bodyError(FIELD, `Line ${line}: ${message}`, line));
    const earlier = firstLine.get(blockId);
    const number = TURN_ID.exec(blockId)?.[1];
    if (earlier !== undefined) say(`^${blockId} is already the id of line ${earlier}`);
    else if (number === undefined)
      say(`^${blockId} is not a turn id: write ^t0001, ^t0002, … in order`);
    else if (Number(number) <= previous) say(`^${blockId} comes after a higher id: turn ids rise`);
    firstLine.set(blockId, firstLine.get(blockId) ?? line);
    if (number !== undefined) previous = Math.max(previous, Number(number));
  }
  return errors;
}

/**
 * A Transcript section's turns, one per block, as meeting/v1 writes them:
 * `**Speaker** [hh:mm:ss] words ^t0001`. A turn without a block id is
 * reported, never given one: an id made up here would not be in the file,
 * so nothing could cite it. Every block must be a turn, and there must be one.
 */
export function parseTranscript(section: string, options: TranscriptOptions): ParsedTranscript {
  const read = { selfName: options.selfName, clock: options.clock ?? 'elapsed' };
  const readings = lineBlocks(section, options.firstLine).map((block) => readTurn(block, read));
  const turns = readings.flatMap(({ turn }) => (turn === null ? [] : [turn]));
  const errors = [...readings.flatMap((reading) => reading.errors), ...turnIdErrors(turns)];
  if (readings.length === 0) {
    const message = 'Transcript is empty: leave the section out when there is no transcript';
    errors.push(bodyError(FIELD, message, options.firstLine - 1));
  }
  return { turns, errors };
}
