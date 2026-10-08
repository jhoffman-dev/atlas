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
 * New entries go at the end; past {@link MAX_LOG_ENTRIES} the oldest go, so
 * the file stays a size a person will read.
 */

import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { AUTOMATIONS_DIRECTORY } from '../vault/vault-visibility.ts';
import type { PassedOver } from './automation-plan.ts';
import type { NoteVersionRef } from './note-trigger.ts';
import type { LocalTime } from './schedule.ts';

export const MAX_LOG_ENTRIES = 100;
export const LOG_MARKER_VALUE = 'automation-log';

/** What a property held before a rule set it: a value, or no such key at all. */
export type PriorValue = { readonly absent: true } | { readonly value: unknown };

/** One thing a run, or an undo, did to one note. */
export type DoneAction =
  | { readonly kind: 'archived'; readonly from: VaultPath; readonly to: VaultPath }
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
    }
  | {
      readonly kind: 'undo';
      readonly at: LocalTime;
      /** When the run it undid ran. */
      readonly of: LocalTime;
      readonly done: readonly DoneAction[];
      readonly left: readonly PassedOver[];
    }
  /** A run that could not start — its query did not read — and why. */
  | {
      readonly kind: 'failed';
      readonly at: LocalTime;
      readonly trigger: RunTrigger;
      readonly problem: string;
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
  const change = `${prior(action.before)} → ${prior(action.after)}`;
  return `- ${action.kind} ${code(action.path)} ${code(action.key)}: ${change}`;
}

/** A sentence for the entry, above its lines. */
export function logEntrySummary(entry: LogEntry): string {
  if (entry.kind === 'turnedOn' || entry.kind === 'seen') {
    return 'It runs on its schedule from here on.';
  }
  if (entry.kind === 'failed') return oneLine(entry.problem);
  const counts = countDone(entry.done);
  const left = entry.left.length === 0 ? '' : ` Left ${entry.left.length} alone.`;
  // The cap counts notes: a rule setting two properties makes two lines per note.
  const notes = new Set(entry.done.map((action) => ('path' in action ? action.path : action.from)));
  const capped =
    entry.kind === 'run' && entry.capped
      ? ` Stopped at ${notes.size}, the most one run may do; the rest wait for the next run.`
      : '';
  return `${counts}${left}${capped}`;
}

function countDone(done: readonly DoneAction[]): string {
  const notes = (count: number) => `${count} ${count === 1 ? 'note' : 'notes'}`;
  const tally = (kind: DoneAction['kind']) => done.filter((action) => action.kind === kind).length;
  const changed = new Set(done.flatMap((action) => (action.kind === 'set' ? [action.path] : [])))
    .size;
  const restored = new Set(
    done.flatMap((action) => (action.kind === 'restored' ? [action.path] : [])),
  ).size;
  const parts = [
    tally('archived') > 0 ? `Archived ${notes(tally('archived'))}.` : '',
    tally('unarchived') > 0 ? `Put back ${notes(tally('unarchived'))}.` : '',
    changed > 0 ? `Changed ${notes(changed)}.` : '',
    restored > 0 ? `Restored ${notes(restored)}.` : '',
  ].filter((part) => part !== '');
  return parts.length === 0 ? 'Nothing to do.' : parts.join(' ');
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
      ? entry.left.map(({ path, reason }) => `- left ${code(path)}: ${oneLine(reason)}`)
      : [];
  const versions = entry.kind === 'run' ? (entry.versions ?? []).map(versionLine) : [];
  if (done.length + left.length + versions.length > 0) {
    lines.push('', ...done, ...left, ...versions);
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

const HEADING = /^## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) · (.+)$/;
const JSON_SPAN = '`((?:[^`])*)`';
const PRIOR_SPAN = `(nothing|${JSON_SPAN})`;
const MOVE_LINE = new RegExp(`^- (archived|unarchived) ${JSON_SPAN} → ${JSON_SPAN}$`);
const SET_LINE = new RegExp(
  `^- (set|restored) ${JSON_SPAN} ${JSON_SPAN}: ${PRIOR_SPAN} → ${PRIOR_SPAN}$`,
);
const LEFT_LINE = new RegExp(`^- left ${JSON_SPAN}: (.*)$`);
const VERSION_LINE = new RegExp(`^- (triggered by|wrote) ${JSON_SPAN} at ${JSON_SPAN}$`);

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
  if (title.endsWith(', and could not')) {
    return { kind: 'failed', at, trigger, problem: body.find((line) => line !== '') ?? '' };
  }
  const capped = body.some((line) => line.includes('the most one run may do'));
  const versions = body.flatMap((line) => {
    const version = readVersion(line);
    return version === null ? [] : [version];
  });
  return {
    kind: 'run',
    at,
    trigger,
    capped,
    ...linesOf(body),
    ...(versions.length > 0 && { versions }),
  };
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

/**
 * The run that "Undo last run" undoes: the newest run that did something,
 * unless it has been undone already. Only the last one — undoing further back
 * would put back notes that later runs have acted on since.
 */
export function lastUndoableRun(
  entries: readonly LogEntry[],
): Extract<LogEntry, { kind: 'run' }> | null {
  const at = entries.findLastIndex((entry) => entry.kind === 'run' && entry.done.length > 0);
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

/** The newest run, successful or not; null when it has never run. */
export function lastRunOf(
  entries: readonly LogEntry[],
): Extract<LogEntry, { kind: 'run' | 'failed' }> | null {
  const runs = entries.filter(
    (entry): entry is Extract<LogEntry, { kind: 'run' | 'failed' }> =>
      entry.kind === 'run' || entry.kind === 'failed',
  );
  return runs.at(-1) ?? null;
}
