import { oneLine } from './meeting-mapping-error.ts';
import { isBoilerplate, textLines } from './meeting-text.ts';

/** One speaker turn, before it is written. */
export interface Turn {
  readonly speaker: string;
  /** `hh:mm:ss`; the turn's own (Granola) or its section's (Gemini, approximate). */
  readonly time: string | null;
  readonly approximate: boolean;
  readonly words: string;
}

/** What the transcript's times count: since the recording started, or the time of day. */
export type TranscriptClock = 'elapsed' | 'wall';

export interface Transcript {
  readonly turns: readonly Turn[];
  readonly clock: TranscriptClock;
  /**
   * How long the recording ran, in seconds: Gemini's end mark, else its last
   * section stamp (a little short). Null on a wall clock, or with neither.
   */
  readonly length: number | null;
}

/** The provider's wrapper and end lines: a date, `📖 Transcript`, `<details>`, the end mark. */
const DROPPED = [
  /^<\/?(details|summary)\b[^>]*>(.*<\/summary>)?$/i,
  /^(📖\s*)?transcript$/i,
  /^(#{1,6}\s*)?transcription ended after\b/i,
  /^((mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?[a-z]{3,9}\.?\s+\d{1,2},\s+\d{4}$/i,
  /^\d{4}-\d{2}-\d{2}$/,
];
/** Gemini's end mark, `### Transcription ended after 00:51:49`: how long the recording ran. */
const ENDED = /^(?:#{1,6}\s*)?transcription ended after\s+(\d{1,2}:\d{2}:\d{2})\b/i;
/** Gemini's section stamp: `### 00:09:44` (or the bare time). */
const SECTION = /^(?:#{1,6}\s*)?(\d{1,2}:\d{2}:\d{2})$/;
/** An elapsed time the contract reads: any hours, minutes and seconds under 60. */
const ELAPSED_TIME = /^\d{2,}:[0-5]\d:[0-5]\d$/;
/** Granola's turn: `**[14:14:22] You:** words`. */
const STAMPED = /^(?:\*\*)?\[(\d{1,2}:\d{2}:\d{2})\]\s*([^:*\]]+?)\s*:(?:\*\*)?\s*(.*)$/;
/** Gemini's turn: `Speaker Name: words`, `**Speaker Name:** words` or `**Speaker Name**: words`. */
const SPOKEN = /^(?:\*\*)?([^:*\s][^:*]{0,79}?)(?:\*\*)?\s*:(?:\*\*)?(?:\s+(.*))?$/;
/** A list bullet a provider may put before a turn. */
const BULLET = /^[-*+]\s+/;
/** A time of day, which a wall-clock (Granola) stamp is: never past 23:59:59. */
const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
/** A `^id`-shaped word, which the provider's words must not carry. */
const INNER_ID = /(^|\s)\^([A-Za-z0-9-]+)(?=\s|$)/g;
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
/** What providers call a speaker they could not name, and the vault's owner (as Atlas reads them). */
const PROVIDER_LABEL =
  /^(?:you|(?:(?:unknown|remote)(?: speaker)?|speaker|guest|participant)(?: (?:\d+|[a-z]))?)$/i;
/**
 * The fixed set of labels that are never a person speaking: words a note
 * line opens with (`Note:`, `Action item:`, `URL:`, `TODO:` …). Nothing else
 * is ruled out, since a Gemini speaker need not be an attendee.
 */
const NOTE_LABEL =
  /^(?:note|notes|nb|ps|fyi|re|todo|to do|action items?|next steps?|decisions?|questions?|answers?|agenda|summary|update|reminder|link|url|https?|e-?mail|phone|subject|date|time)$/i;

const padded = (time: string) => (time.length === 7 ? `0${time}` : time);

/** The speaker as the contract writes them: `Remote Speaker` is `Unknown`. */
function speakerName(written: string): string {
  const name = oneLine(written.replace(/\*/g, ''));
  if (/^remote speaker$/i.test(name)) return 'Unknown';
  if (/^you$/i.test(name)) return 'You';
  return name === '' ? 'Unknown' : name;
}

/** A transcript line without its indent and without Notion's `\[`, `\]` and `\*` escapes. */
const plain = (line: string) => line.trim().replace(/\\([[\]*_])/g, '$1');

/** A turn while it is read: its words gathered as parts and joined once, so a long turn costs linear time. */
interface OpenTurn {
  readonly speaker: string;
  readonly time: string | null;
  readonly approximate: boolean;
  readonly parts: string[];
}

/**
 * Reads lines in order, keeping the section time a Gemini turn falls under.
 *
 * Whether `Label: words` starts a turn (the label is a person) or continues
 * the one before (the words hold a colon, like `Note: we ship Friday`):
 *
 * 1. A note label (`Note`, `Action item`, `URL`, …) never starts a turn.
 * 2. In a Gemini transcript (no Granola stamp read yet) any other label
 *    does: Gemini writes one labelled line per turn, and its speakers are
 *    often missing from the attendees (a shared room, a group invite).
 * 3. In a Granola transcript, where every turn is stamped, an unstamped
 *    label starts a turn when there is no turn yet, on the first line after
 *    a section stamp, when the label has no words after it, when it is a
 *    speaker already heard, an attendee's name (any case), or a provider's
 *    own label (`You`, `Remote Speaker`, `Speaker 2`) — or when the meeting
 *    has no attendee names to check it against. Otherwise it continues the
 *    turn before.
 */
class TurnReader {
  readonly turns: OpenTurn[] = [];
  stamped = false;
  /** The last elapsed time read: a section stamp, then the end mark when there is one. */
  lastElapsed: string | null = null;
  private section: string | null = null;
  private afterSection = false;
  private readonly heard = new Set<string>();
  private readonly roster: ReadonlySet<string>;

  constructor(roster: ReadonlySet<string>) {
    this.roster = roster;
  }

  read(line: string): void {
    const ended = padded(ENDED.exec(line)?.[1] ?? '');
    if (ELAPSED_TIME.test(ended)) this.lastElapsed = ended;
    if (line === '' || isBoilerplate(line) || DROPPED.some((each) => each.test(line))) return;
    const section = SECTION.exec(line);
    if (section !== null) {
      const time = padded(section[1] ?? '');
      this.section = ELAPSED_TIME.test(time) ? time : null;
      this.lastElapsed = this.section ?? this.lastElapsed;
      this.afterSection = true;
    } else if (!this.stampedTurn(line) && !this.spokenTurn(line)) this.continueTurn(line);
  }

  private stampedTurn(line: string): boolean {
    const match = STAMPED.exec(line);
    if (match === null) return false;
    this.stamped = true;
    const time = padded(match[1] ?? '');
    this.add(match[2] ?? '', WALL_TIME.test(time) ? time : null, false, match[3] ?? '');
    return true;
  }

  private spokenTurn(line: string): boolean {
    const match = SPOKEN.exec(line.replace(BULLET, ''));
    const label = match?.[1];
    if (match === null || label === undefined || !this.isSpeaker(label, match[2] ?? '')) {
      return false;
    }
    this.add(label, this.section, true, match[2] ?? '');
    return true;
  }

  private isSpeaker(label: string, words: string): boolean {
    const name = speakerName(label).toLowerCase();
    if (NOTE_LABEL.test(name)) return false;
    if (!this.stamped) return true;
    if (this.turns.length === 0 || this.afterSection || words.trim() === '') return true;
    if (this.heard.has(name) || this.roster.has(name) || PROVIDER_LABEL.test(name)) return true;
    return this.roster.size === 0;
  }

  /** A line with no speaker belongs to the turn before it, or is a turn nobody was named for. */
  private continueTurn(line: string): void {
    const last = this.turns.at(-1);
    if (last === undefined) this.add('', this.section, true, line);
    else last.parts.push(line);
    this.afterSection = false;
  }

  private add(speaker: string, time: string | null, approximate: boolean, words: string): void {
    const name = speakerName(speaker);
    this.heard.add(name.toLowerCase());
    this.turns.push({ speaker: name, time, approximate, parts: [words] });
    this.afterSection = false;
  }
}

/**
 * The turns of a provider's transcript: Gemini's `Speaker: words` lines under
 * `### hh:mm:ss` section stamps (times approximate), or Granola's
 * `**[hh:mm:ss] Speaker:** words` lines (times exact, of the day). The date
 * line, the wrapper, the end mark and the disclaimer are dropped.
 * `attendeeNames` are the people a `Name:` line may be spoken by (see TurnReader).
 */
export function readTranscript(value: unknown, attendeeNames: readonly string[] = []): Transcript {
  const reader = new TurnReader(new Set(attendeeNames.map((each) => each.toLowerCase())));
  for (const line of textLines(value, 'transcript')) reader.read(plain(line));
  const clock: TranscriptClock = reader.stamped ? 'wall' : 'elapsed';
  const turns = reader.turns
    .map(({ parts, ...turn }) => ({
      ...turn,
      // On a wall clock, a section time past 23:59:59 is not a time of day.
      time: clock === 'wall' && turn.time !== null && !WALL_TIME.test(turn.time) ? null : turn.time,
      words: oneLine(parts.join(' ')),
    }))
    .filter((turn) => turn.words !== '');
  return { turns, clock, length: clock === 'elapsed' ? seconds(reader.lastElapsed) : null };
}

function seconds(time: string | null): number | null {
  if (time === null) return null;
  const [hours = 0, minutes = 0, secs = 0] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + secs;
}

/** When the first stamped turn was spoken, as `HH:MM`: a start for a wall-clock transcript. */
export function firstSpoken({ turns, clock }: Transcript): string | null {
  if (clock !== 'wall') return null;
  const time = turns.find((turn) => turn.time !== null)?.time?.slice(0, 5) ?? null;
  return time !== null && TIME_OF_DAY.test(time) ? time : null;
}

const blockId = (index: number) => `t${String(index + 1).padStart(4, '0')}`;

function turnLine(turn: Turn, index: number): string {
  const stamp = turn.time === null ? '' : ` [${turn.approximate ? '~' : ''}${turn.time}]`;
  // With no stamp, a bracket opening the words would be read as the time.
  const bracketed = stamp === '' ? turn.words.replace(/^\[/, '\\[') : turn.words;
  // A `^id` in the words would be a block id inside the turn; only the turn's own ends it.
  const words = bracketed.replace(INNER_ID, '$1\\^$2');
  return `**${turn.speaker}**${stamp} ${words} ^${blockId(index)}`;
}

/** The Transcript section's body: one paragraph per turn, ids `^t0001` onward. */
export function transcriptText(turns: readonly Turn[]): string {
  return turns.map(turnLine).join('\n\n');
}
