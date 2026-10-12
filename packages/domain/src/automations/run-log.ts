/**
 * An automation's run log (P25-02): what each run did, in a markdown note a
 * person can read, and exact enough that the last run can be undone from it.
 *
 * Each entry is a `##` section — when, and what happened — then one line per
 * thing done. Paths and values are written as JSON inside code spans, so a
 * note called `a → b.md` or a value with quotes in it reads back as it was:
 *
 * ```markdown
 * ## 2026-09-27 03:00:12 · Ran on schedule
 *
 * Archived 2 notes. Left 1 alone.
 *
 * - archived `"Tasks/A.md"` → `"Archive/Tasks/A.md"`
 * - set `"Tasks/B.md"` `"status"`: `"todo"` → `"done"`
 * - left `"Tasks/C.md"`: It is open in Atlas with unsaved typing.
 * ```
 *
 * A rule a note sets off (P29-01) also writes which version of each note it
 * handled, and the version its own write left, so neither sets it off again:
 *
 * ```markdown
 * - triggered by `"Inbox/Meetings/Standup.md"` at `"1a2b3c4d"`
 * - wrote `"Inbox/Meetings/Standup.md"` at `"5e6f7a8b"`
 * ```
 *
 * And a note of its type it had handled that was deleted, so a new note made
 * at that path later — even from the same bytes — is new to it:
 *
 * ```markdown
 * - went `"Inbox/Meetings/Standup.md"`
 * ```
 *
 * A rule's Claude step (P29-03) writes what it made — never an edit — and
 * which model answered, and how long it took:
 *
 * ```markdown
 * - proposed `"Inbox/Proposals/Send the payroll file.md"`
 * - created `"Briefs/Morning brief.md"`
 * - claude `"claude-opus-5-5"` in `4210` ms
 * ```
 *
 * A note too long to show the model whole is said, with how much it saw, so
 * a transcript read in part is never taken for one read whole:
 *
 * ```markdown
 * - cut `"Meetings/2026-10-01 Standup.md"`: read `19874` of `48211` characters
 * ```
 *
 * An output that reads a long meeting in parts (P29-05) says how many times it
 * asked, and names each item it left out of an answer it otherwise kept:
 *
 * ```markdown
 * - asked `3` times
 * - dropped `"Send the contract"`: Vendor call has no transcript turn ^t0099 that Claude was shown.
 * ```
 *
 * New entries go at the end; past {@link MAX_LOG_ENTRIES} the oldest go, so
 * the file stays a size a person will read.
 */

import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { AUTOMATIONS_DIRECTORY } from '../vault/vault-visibility.ts';
import { truncated } from './answer-limits.ts';
import type { PassedOver } from './automation-plan.ts';
import type { NoteCut } from './answered-note.ts';
import type { DroppedItem } from './proposal-schema.ts';
import { CLAUDE_NOTES_PER_RUN } from './claude-step.ts';
import type { NoteVersionRef } from './note-trigger.ts';
import type { LocalTime } from './schedule.ts';

export const MAX_LOG_ENTRIES = 100;
export const LOG_MARKER_VALUE = 'automation-log';

/** What a property held before a rule set it: a value, or no such key at all. */
export type PriorValue = { readonly absent: true } | { readonly value: unknown };

/** One thing a run, or an undo, did to one note. */
export type DoneAction =
  | { readonly kind: 'archived'; readonly from: VaultPath; readonly to: VaultPath }
  /** A Claude step made a proposal. */
  | { readonly kind: 'proposed'; readonly path: VaultPath }
  /** A Claude step made the one new note its rule asks for. */
  | { readonly kind: 'created'; readonly path: VaultPath }
  | { readonly kind: 'unarchived'; readonly from: VaultPath; readonly to: VaultPath }
  | {
      readonly kind: 'set' | 'restored';
      readonly path: VaultPath;
      readonly key: string;
      readonly before: PriorValue;
      readonly after: PriorValue;
    };

/** What started a run. */
export type RunTrigger = 'schedule' | 'open' | 'hand' | 'note';

/** A note version a run of a note-triggered rule handled, or left by its own write. */
export interface LoggedVersion extends NoteVersionRef {
  /** True for the version the run's own write left; false for one that was handled. */
  readonly wrote: boolean;
}

/** Which model a Claude step asked, and how long it took to answer — or to fail. */
export interface ClaudeRunInfo {
  readonly model: string;
  readonly ms: number;
  /**
   * The notes it was shown only the start of — a long transcript, say — so
   * whoever reads the log knows what the model never saw; left out when it
   * read every note whole.
   */
  readonly cut?: readonly NoteCut[];
  /** How many times it asked, when more than once: a long meeting read in parts. */
  readonly asks?: number;
  /** The items of its answers it left out while keeping the rest, each with why. */
  readonly dropped?: readonly DroppedItem[];
}

/** The longest an item's title runs in a log line: it is a model's, and a line is not a note. */
const MAX_DROPPED_TITLE = 120;

export type LogEntry =
  | {
      readonly kind: 'run';
      readonly at: LocalTime;
      readonly trigger: RunTrigger;
      readonly done: readonly DoneAction[];
      readonly left: readonly PassedOver[];
      readonly capped: boolean;
      /** For a rule a note sets off: the versions it handled and the ones it wrote. */
      readonly versions?: readonly LoggedVersion[];
      /** For a rule a note sets off: notes it had handled that were deleted, ending their history. */
      readonly went?: readonly VaultPath[];
      /** For a Claude step: the model it asked. */
      readonly claude?: ClaudeRunInfo;
    }
  | {
      readonly kind: 'undo';
      readonly at: LocalTime;
      /** When the run it undid ran. */
      readonly of: LocalTime;
      readonly done: readonly DoneAction[];
      readonly left: readonly PassedOver[];
    }
  /** A run that could not start — its query did not read — or whose Claude step failed, and why. */
  | {
      readonly kind: 'failed';
      readonly at: LocalTime;
      readonly trigger: RunTrigger;
      readonly problem: string;
      /** For a Claude step that was asked: the model, and how long until it failed. */
      readonly claude?: ClaudeRunInfo;
      /** For a Claude step cut off part-way: what it had already made, which stays. */
      readonly done?: readonly DoneAction[];
    }
  | { readonly kind: 'turnedOn'; readonly at: LocalTime }
  /** A rule Atlas found that had never run nor been turned on here: its schedule counts from then. */
  | { readonly kind: 'seen'; readonly at: LocalTime };

/**
 * The most a log holds, in bytes, whatever its entries' count: a run that
 * changed 500 notes writes a long entry, and a hundred of those is no note a
 * person will read, nor one worth re-reading every minute.
 */
export const MAX_LOG_BYTES = 256 * 1024;

/** Where a rule's log is kept: beside the rules, under `log/`, named after the rule's id. */
export function logPathFor(ruleId: string): VaultPath {
  return createVaultPath(`${AUTOMATIONS_DIRECTORY}/log/${ruleId}.md`);
}

const TRIGGER_WORDS: Readonly<Record<RunTrigger, string>> = {
  schedule: 'Ran on schedule',
  open: 'Ran when Atlas opened',
  hand: 'Ran by hand',
  note: 'Ran when a note appeared or changed',
};

/** A wall-clock time as a heading shows it: a space where ISO has the `T`. */
const shown = (time: LocalTime): string => time.replace('T', ' ');

/** JSON in a code span; a backtick escaped so the span cannot end early. */
const code = (value: unknown): string => `\`${JSON.stringify(value).replace(/`/g, '\\u0060')}\``;
const prior = (value: PriorValue): string => ('absent' in value ? 'nothing' : code(value.value));

/** What an entry was, as its heading says after the time: "Ran on schedule". */
export function logEntryHeading(entry: LogEntry): string {
  switch (entry.kind) {
    case 'run':
      return TRIGGER_WORDS[entry.trigger];
    case 'failed':
      return `${TRIGGER_WORDS[entry.trigger]}, and could not`;
    case 'undo':
      return `Undid the run of ${shown(entry.of)}`;
    case 'turnedOn':
      return 'Turned on';
    case 'seen':
      return 'First seen';
  }
}

function actionLine(action: DoneAction): string {
  if (action.kind === 'archived' || action.kind === 'unarchived') {
    return `- ${action.kind} ${code(action.from)} → ${code(action.to)}`;
  }
  if (action.kind === 'proposed' || action.kind === 'created') {
    return `- ${action.kind} ${code(action.path)}`;
  }
  const change = `${prior(action.before)} → ${prior(action.after)}`;
  return `- ${action.kind} ${code(action.path)} ${code(action.key)}: ${change}`;
}

/** A sentence for the entry, above its lines. */
export function logEntrySummary(entry: LogEntry): string {
  if (entry.kind === 'turnedOn' || entry.kind === 'seen') {
    return 'It runs on its schedule from here on.';
  }
  // A failure's words can be a model's (a tool it named, a title it chose): bounded, as the log is.
  if (entry.kind === 'failed') return oneLine(truncated(entry.problem));
  const askedForNothing =
    entry.kind === 'run' && entry.claude !== undefined && entry.done.length === 0;
  const counts = askedForNothing ? 'Claude proposed nothing.' : countDone(entry.done);
  const left = entry.left.length === 0 ? '' : ` Left ${entry.left.length} alone.`;
  // The cap counts notes: a rule setting two properties makes two lines per note.
  const notes = new Set(entry.done.map((action) => ('path' in action ? action.path : action.from)));
  const capped = entry.kind === 'run' && entry.capped ? cappedWords(entry, notes.size) : '';
  const claude = 'claude' in entry ? entry.claude : undefined;
  return `${counts}${left}${capped}${cutWords(claude?.cut ?? [])}${droppedWords(claude?.dropped ?? [])}`;
}

/** What a run says when it left items out of an answer it kept. */
function droppedWords(dropped: readonly DroppedItem[]): string {
  if (dropped.length === 0) return '';
  const items = dropped.length === 1 ? '1 item' : `${dropped.length} items`;
  return ` Left out ${items} that cited no turn of the meeting.`;
}

/** What a run says when a note was too long to show the model whole. */
function cutWords(cut: readonly NoteCut[]): string {
  if (cut.length === 0) return '';
  const notes = cut.length === 1 ? '1 note was' : `${cut.length} notes were`;
  return ` ${notes} too long to read whole: Claude saw only the start.`;
}

/** What a run that stopped short says; a Claude step is held to fewer notes, and the rest wait for a run by hand. */
function cappedWords(entry: Extract<LogEntry, { kind: 'run' }>, changed: number): string {
  return entry.claude === undefined
    ? ` Stopped at ${changed}, the most one run may do; the rest wait for the next run.`
    : ` ${CLAUDE_CAPPED}`;
}

function countDone(done: readonly DoneAction[]): string {
  const notes = (count: number) => `${count} ${count === 1 ? 'note' : 'notes'}`;
  const tally = (kind: DoneAction['kind']) => done.filter((action) => action.kind === kind).length;
  const changed = new Set(done.flatMap((action) => (action.kind === 'set' ? [action.path] : [])))
    .size;
  const restored = new Set(
    done.flatMap((action) => (action.kind === 'restored' ? [action.path] : [])),
  ).size;
  const proposals = (count: number) => `${count} ${count === 1 ? 'proposal' : 'proposals'}`;
  const parts = [
    tally('archived') > 0 ? `Archived ${notes(tally('archived'))}.` : '',
    tally('unarchived') > 0 ? `Put back ${notes(tally('unarchived'))}.` : '',
    changed > 0 ? `Changed ${notes(changed)}.` : '',
    restored > 0 ? `Restored ${notes(restored)}.` : '',
    tally('proposed') > 0 ? `Made ${proposals(tally('proposed'))}.` : '',
    tally('created') > 0 ? `Made ${notes(tally('created'))}.` : '',
  ].filter((part) => part !== '');
  return parts.length === 0 ? 'Nothing to do.' : parts.join(' ');
}

function claudeLines({ model, ms, cut = [], asks, dropped = [] }: ClaudeRunInfo): string[] {
  return [
    `- claude ${code(model)} in ${code(ms)} ms`,
    ...(asks === undefined ? [] : [`- asked ${code(asks)} times`]),
    ...cut.map(
      ({ path, shown, of }) => `- cut ${code(path)}: read ${code(shown)} of ${code(of)} characters`,
    ),
    ...dropped.map(
      ({ title, reason }) =>
        `- dropped ${code(truncated(oneLine(title), MAX_DROPPED_TITLE))}: ${oneLine(truncated(reason))}`,
    ),
  ];
}

function versionLine({ path, digest, wrote }: LoggedVersion): string {
  return `- ${wrote ? 'wrote' : 'triggered by'} ${code(path)} at ${code(digest)}`;
}

/** One entry, as the markdown the log holds. */
export function formatLogEntry(entry: LogEntry): string {
  const lines = [`## ${shown(entry.at)} · ${logEntryHeading(entry)}`, '', logEntrySummary(entry)];
  const done = 'done' in entry ? entry.done.map(actionLine) : [];
  const left =
    'left' in entry
      ? entry.left.map(({ path, reason }) => `- left ${code(path)}: ${oneLine(truncated(reason))}`)
      : [];
  const versions = entry.kind === 'run' ? (entry.versions ?? []).map(versionLine) : [];
  const went = entry.kind === 'run' ? (entry.went ?? []).map((path) => `- went ${code(path)}`) : [];
  const claude = 'claude' in entry && entry.claude !== undefined ? claudeLines(entry.claude) : [];
  if (done.length + left.length + versions.length + went.length + claude.length > 0) {
    lines.push('', ...done, ...left, ...versions, ...went, ...claude);
  }
  return `${lines.join('\n')}\n`;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A new log's text, for the rule named. */
export function newLogText(ruleName: string, entries: readonly LogEntry[]): string {
  const head = `---\natlas: ${LOG_MARKER_VALUE}\n---\n\n# ${oneLine(ruleName)} — run log\n\n`;
  return head + entries.map(formatLogEntry).join('\n');
}

/**
 * The log with one more entry: the text before the first entry kept as it
 * was, the oldest entries dropped past the most a log keeps — by count and by
 * bytes. A section that is no entry — a person's own `## Notes` — is theirs,
 * and is never what makes room.
 */
export function appendLogEntry({
  text,
  ruleName,
  entry,
  keep = MAX_LOG_ENTRIES,
  maxBytes = MAX_LOG_BYTES,
}: {
  /** The log as it is; null when there is none yet. */
  text: string | null;
  ruleName: string;
  entry: LogEntry;
  keep?: number;
  maxBytes?: number;
}): string {
  const { head, sections } =
    text === null ? { head: newLogText(ruleName, []), sections: [] } : splitSections(text);
  const all = [...sections, formatLogEntry(entry)].map((section) => section.replace(/\n*$/, '\n'));
  const isEntry = all.map((section) => parseSection(section) !== null);
  const bytes = all.map((section) => utf8Length(section) + 1);
  let entries = isEntry.filter(Boolean).length;
  let total = utf8Length(head) + bytes.reduce((sum, size) => sum + size, 0);
  const dropped = new Set<number>();
  // The newest entry, the one being added, always stays.
  for (let at = 0; at < all.length - 1 && (entries > keep || total > maxBytes); at += 1) {
    if (!isEntry[at]) continue;
    dropped.add(at);
    entries -= 1;
    total -= bytes[at]!;
  }
  return `${head}${all.filter((_, at) => !dropped.has(at)).join('\n')}`;
}

/** Bytes of UTF-8 text, as the file on disk holds it. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function splitSections(text: string): { head: string; sections: string[] } {
  const starts = [...text.matchAll(/^## /gm)].map((match) => match.index);
  if (starts.length === 0)
    return { head: text.endsWith('\n') ? `${text}\n` : `${text}\n\n`, sections: [] };
  const head = text.slice(0, starts[0]);
  const sections = starts.map((start, index) => text.slice(start, starts[index + 1]));
  return { head, sections };
}

/** How a Claude step's log says it read only the first of the notes; parsed back as `capped`. */
const CLAUDE_CAPPED = `Read the first ${CLAUDE_NOTES_PER_RUN} notes, the most one Claude run takes; run it by hand for the rest.`;

const HEADING = /^## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) · (.+)$/;
const JSON_SPAN = '`((?:[^`])*)`';
const PRIOR_SPAN = `(nothing|${JSON_SPAN})`;
const MOVE_LINE = new RegExp(`^- (archived|unarchived) ${JSON_SPAN} → ${JSON_SPAN}$`);
const MADE_LINE = new RegExp(`^- (proposed|created) ${JSON_SPAN}$`);
const CLAUDE_LINE = new RegExp(`^- claude ${JSON_SPAN} in ${JSON_SPAN} ms$`);
const CUT_LINE = new RegExp(`^- cut ${JSON_SPAN}: read ${JSON_SPAN} of ${JSON_SPAN} characters$`);
const ASKED_LINE = new RegExp(`^- asked ${JSON_SPAN} times$`);
const DROPPED_LINE = new RegExp(`^- dropped ${JSON_SPAN}: (.*)$`);
const SET_LINE = new RegExp(
  `^- (set|restored) ${JSON_SPAN} ${JSON_SPAN}: ${PRIOR_SPAN} → ${PRIOR_SPAN}$`,
);
const LEFT_LINE = new RegExp(`^- left ${JSON_SPAN}: (.*)$`);
const VERSION_LINE = new RegExp(`^- (triggered by|wrote) ${JSON_SPAN} at ${JSON_SPAN}$`);
const WENT_LINE = new RegExp(`^- went ${JSON_SPAN}$`);

/**
 * Reads a log back into its entries, oldest first. A section or line that does
 * not read — the log is a note, and a person may have edited it — is left out
 * rather than guessed at, so undo only ever does what the log exactly says.
 */
export function parseRunLog(text: string): LogEntry[] {
  return splitSections(text).sections.flatMap((section) => {
    const entry = parseSection(section);
    return entry === null ? [] : [entry];
  });
}

function parseSection(section: string): LogEntry | null {
  const [heading = '', ...rest] = section.split('\n');
  const match = HEADING.exec(heading.trim());
  if (match === null) return null;
  const at = `${match[1]}T${match[2]}`;
  const title = match[3]!;
  const body = rest.map((line) => line.trim());
  if (title === 'Turned on') return { kind: 'turnedOn', at };
  if (title === 'First seen') return { kind: 'seen', at };
  const undid = /^Undid the run of (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(title);
  if (undid !== null) {
    return { kind: 'undo', at, of: `${undid[1]}T${undid[2]}`, ...linesOf(body) };
  }
  const trigger = triggerOf(title.replace(/, and could not$/, ''));
  if (trigger === null) return null;
  const claude = claudeOf(body);
  const made = linesOf(body).done;
  if (title.endsWith(', and could not')) {
    return {
      kind: 'failed',
      at,
      trigger,
      problem: body.find((line) => line !== '') ?? '',
      ...(claude !== null && { claude }),
      ...(made.length > 0 && { done: made }),
    };
  }
  const capped = body.some(
    (line) => line.includes('the most one run may do') || line.includes(CLAUDE_CAPPED),
  );
  const versions = body.flatMap((line) => {
    const version = readVersion(line);
    return version === null ? [] : [version];
  });
  const went = body.flatMap((line) => {
    const path = readWent(line);
    return path === null ? [] : [path];
  });
  return {
    kind: 'run',
    at,
    trigger,
    capped,
    ...linesOf(body),
    ...(versions.length > 0 && { versions }),
    ...(went.length > 0 && { went }),
    ...(claude !== null && { claude }),
  };
}

/** The model a Claude step asked, from its line; null when there is none, or it does not read. */
function claudeOf(body: readonly string[]): ClaudeRunInfo | null {
  for (const line of body) {
    const match = CLAUDE_LINE.exec(line);
    if (match === null) continue;
    try {
      const model = JSON.parse(match[1]!) as unknown;
      const ms = JSON.parse(match[2]!) as unknown;
      if (typeof model === 'string' && typeof ms === 'number') {
        const cut = cutOf(body);
        const asks = asksOf(body);
        const dropped = droppedOf(body);
        return {
          model,
          ms,
          ...(cut.length > 0 && { cut }),
          ...(asks !== null && { asks }),
          ...(dropped.length > 0 && { dropped }),
        };
      }
    } catch {
      // A line edited into JSON that does not read is left out, as any other line is.
    }
    return null;
  }
  return null;
}

/** The notes a Claude step read only the start of, from its lines; one that does not read is left out. */
function cutOf(body: readonly string[]): NoteCut[] {
  return body.flatMap((line) => {
    const match = CUT_LINE.exec(line);
    if (match === null) return [];
    try {
      const [shown, of] = [JSON.parse(match[2]!) as unknown, JSON.parse(match[3]!) as unknown];
      if (typeof shown !== 'number' || typeof of !== 'number') return [];
      return [{ path: pathOf(match[1]!), shown, of }];
    } catch {
      // A line edited into JSON that does not read, or a path that is no path, is left out.
      return [];
    }
  });
}

/** How many times a Claude step asked, from its line; null when it says nothing, or does not read. */
function asksOf(body: readonly string[]): number | null {
  for (const line of body) {
    const match = ASKED_LINE.exec(line);
    if (match === null) continue;
    try {
      const asks = JSON.parse(match[1]!) as unknown;
      return typeof asks === 'number' && Number.isInteger(asks) && asks > 1 ? asks : null;
    } catch {
      // A line edited into JSON that does not read is left out, as any other line is.
      return null;
    }
  }
  return null;
}

/** The items a Claude step left out of its answers, from its lines; one that does not read is left out. */
function droppedOf(body: readonly string[]): DroppedItem[] {
  return body.flatMap((line) => {
    const match = DROPPED_LINE.exec(line);
    if (match === null) return [];
    try {
      const title = JSON.parse(match[1]!) as unknown;
      return typeof title === 'string' ? [{ title, reason: match[2]! }] : [];
    } catch {
      // A line edited into JSON that does not read is left out, as any other line is.
      return [];
    }
  });
}

function readWent(line: string): VaultPath | null {
  const match = WENT_LINE.exec(line);
  if (match === null) return null;
  try {
    return pathOf(match[1]!);
  } catch {
    // A line edited into JSON that does not read, or a path that is no path, is left out.
    return null;
  }
}

function readVersion(line: string): LoggedVersion | null {
  const match = VERSION_LINE.exec(line);
  if (match === null) return null;
  try {
    const digest = JSON.parse(match[3]!) as unknown;
    if (typeof digest !== 'string') return null;
    return { path: pathOf(match[2]!), digest, wrote: match[1] === 'wrote' };
  } catch {
    // A line edited into JSON that does not read is left out, as any other line is.
    return null;
  }
}

function triggerOf(title: string): RunTrigger | null {
  const found = Object.entries(TRIGGER_WORDS).find(([, words]) => words === title);
  return found === undefined ? null : (found[0] as RunTrigger);
}

function linesOf(body: readonly string[]): { done: DoneAction[]; left: PassedOver[] } {
  const done: DoneAction[] = [];
  const left: PassedOver[] = [];
  for (const line of body) {
    const read = readLine(line);
    if (read === null) continue;
    if ('reason' in read) left.push(read);
    else done.push(read);
  }
  return { done, left };
}

function readLine(line: string): DoneAction | PassedOver | null {
  try {
    const move = MOVE_LINE.exec(line);
    if (move !== null) {
      const kind = move[1] as 'archived' | 'unarchived';
      return { kind, from: pathOf(move[2]!), to: pathOf(move[3]!) };
    }
    const made = MADE_LINE.exec(line);
    if (made !== null) {
      const path = pathOf(made[2]!);
      return made[1] === 'proposed' ? { kind: 'proposed', path } : { kind: 'created', path };
    }
    const set = SET_LINE.exec(line);
    if (set !== null) {
      const key = JSON.parse(set[3]!) as unknown;
      if (typeof key !== 'string') return null;
      return {
        kind: set[1] as 'set' | 'restored',
        path: pathOf(set[2]!),
        key,
        before: priorOf(set[4]!),
        after: priorOf(set[6]!),
      };
    }
    const left = LEFT_LINE.exec(line);
    if (left !== null) return { path: pathOf(left[1]!), reason: left[2]! };
  } catch {
    // A line edited into JSON that does not read, or a path that is no path, is left out on purpose.
    return null;
  }
  return null;
}

function pathOf(json: string): VaultPath {
  const value = JSON.parse(json) as unknown;
  if (typeof value !== 'string') throw new Error('not a path');
  return createVaultPath(value);
}

function priorOf(written: string): PriorValue {
  if (written === 'nothing') return { absent: true };
  return { value: JSON.parse(written.slice(1, -1)) as unknown };
}

/** When a set value is still what the run left, so undo may put back what was there. */
export function stillAsLeft(current: PriorValue, left: PriorValue): boolean {
  if ('absent' in current || 'absent' in left) return 'absent' in current && 'absent' in left;
  return JSON.stringify(current.value) === JSON.stringify(left.value);
}

/** What undo can put back: a move or a set. What a Claude step made is answered in the Inbox. */
const isUndoable = (action: DoneAction): boolean =>
  action.kind === 'archived' || action.kind === 'set';

/**
 * The run that "Undo last run" undoes: the newest run that did something
 * undo can put back, unless it has been undone already. Only the last one —
 * undoing further back would put back notes that later runs have acted on since.
 */
export function lastUndoableRun(
  entries: readonly LogEntry[],
): Extract<LogEntry, { kind: 'run' }> | null {
  const at = entries.findLastIndex((entry) => entry.kind === 'run' && entry.done.some(isUndoable));
  if (at === -1) return null;
  const last = entries[at] as Extract<LogEntry, { kind: 'run' }>;
  // Only an undo written after it undid it: an earlier run in the same second is another run.
  const undone = entries
    .slice(at + 1)
    .some((entry) => entry.kind === 'undo' && entry.of === last.at);
  return undone ? null : last;
}

const isMark = (entry: LogEntry): boolean =>
  entry.kind === 'run' ||
  entry.kind === 'failed' ||
  entry.kind === 'turnedOn' ||
  entry.kind === 'seen';

/**
 * When a scheduled rule last ran — or tried to, was turned on, or was first
 * seen — which its next run is counted from; null when the log says none of
 * those. A mark later than `now` — a clock that ran fast, a log synced from
 * one — is not counted from: it would hold the rule back until then.
 */
export function lastScheduleMark(entries: readonly LogEntry[], now: LocalTime): LocalTime | null {
  const marks = entries
    .filter(isMark)
    .map((entry) => entry.at)
    .filter((at) => at <= now);
  return marks.length === 0 ? null : marks.reduce((latest, at) => (at > latest ? at : latest));
}

/** The latest mark later than `now`, for the page to say it was ignored; null when there is none. */
export function futureMarkOf(entries: readonly LogEntry[], now: LocalTime): LocalTime | null {
  const ahead = entries
    .filter(isMark)
    .map((entry) => entry.at)
    .filter((at) => at > now);
  return ahead.length === 0 ? null : ahead.reduce((latest, at) => (at > latest ? at : latest));
}

/** Whether a run entry only says notes went: it did, left and handled nothing. */
const isOnlyWent = (entry: Extract<LogEntry, { kind: 'run' }>): boolean =>
  (entry.went ?? []).length > 0 &&
  entry.done.length === 0 &&
  entry.left.length === 0 &&
  (entry.versions ?? []).length === 0;

/**
 * The newest run, successful or not; null when it has never run. An entry
 * that only says notes went (P29-01) is the rule's memory, not a run.
 */
export function lastRunOf(
  entries: readonly LogEntry[],
): Extract<LogEntry, { kind: 'run' | 'failed' }> | null {
  const runs = entries.filter(
    (entry): entry is Extract<LogEntry, { kind: 'run' | 'failed' }> =>
      entry.kind === 'failed' || (entry.kind === 'run' && !isOnlyWent(entry)),
  );
  return runs.at(-1) ?? null;
}
