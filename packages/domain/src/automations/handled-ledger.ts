/**
 * What a rule a note sets off has handled, kept apart from the entries that
 * say how (ADR-0028, "The handled ledger").
 *
 * A log keeps its last 100 entries, so it cannot be the rule's memory: a
 * meeting whose entry aged out would be asked about again, for ever. The
 * ledger is a compact list in the log's own note — a section a person can
 * read, written in the same write as the entry that changed it — of the
 * versions handled, by path, and the words a Claude step answered, each with
 * the time it was recorded. It is pruned by age and by count, never by what
 * else the log is made to hold.
 *
 * ```markdown
 * ## Handled so far
 *
 * - vouches from `"2026-07-01T00:00:00.000Z"`
 * - handled `"Inbox/Meetings/Standup.md"` `"2026-10-08T09:00:00.000Z"`: `["1a2b3c4d"]`
 * - answered `"Inbox/Meetings/Standup.md"` `"2026-10-08T09:00:00.000Z"`: `["1a2b3c4d","body:9f8e"]`
 * ```
 *
 * An answered line holds more than one key for the version: its whole-file
 * digest first, then any a rule's schema names it by (the meeting's body
 * digest or identity), so a note is recognised however the file around it
 * changed. `vouches from` is set once something was forgotten: the ledger
 * cannot say whether a note last written before it was handled.
 */

import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { code, JSON_SPAN } from './log-spans.ts';
import type { LogEntry } from './run-log.ts';
import { localTimeMs } from './schedule.ts';

type Run = Extract<LogEntry, { kind: 'run' }>;

/** The versions a rule handled at one path, newest last, and when it last did. */
export interface PathRecord {
  readonly at: number;
  readonly digests: readonly string[];
}

/** Words a Claude step answered: where, when, and the keys they are known by (the digest first). */
export interface AnsweredRecord {
  readonly at: number;
  readonly path: VaultPath;
  readonly keys: readonly string[];
}

export interface HandledLedger {
  /** Milliseconds; null while nothing was ever forgotten. */
  readonly vouchesFrom: number | null;
  readonly paths: ReadonlyMap<string, PathRecord>;
  readonly answered: readonly AnsweredRecord[];
}

/** How long a record is kept, and the most records a ledger holds. */
export const LEDGER_MAX_AGE_DAYS = 90;
export const MAX_LEDGER_RECORDS = 2000;
/** The versions of one note remembered: older ones come back only by reverting to them. */
const MAX_DIGESTS_PER_PATH = 20;
const DAY_MS = 86_400_000;

export const LEDGER_HEADING = '## Handled so far';
const LEDGER_NOTE =
  'Atlas keeps this list so the rule remembers what it has handled after old entries leave this log. Leave it as it is.';

export const emptyLedger = (): HandledLedger => ({
  vouchesFrom: null,
  paths: new Map(),
  answered: [],
});

/** The ledger once a run has happened: its versions handled, notes gone and notes it archived forgotten. */
export function recordRun(ledger: HandledLedger, entry: Run, at: number): HandledLedger {
  const paths = new Map(ledger.paths);
  let answered = [...ledger.answered];
  for (const path of entry.went ?? []) paths.delete(path);
  for (const { path, digest, wrote, keys = [] } of entry.versions ?? []) {
    const before = paths.get(path)?.digests.filter((each) => each !== digest) ?? [];
    paths.set(path, { at, digests: [...before, digest].slice(-MAX_DIGESTS_PER_PATH) });
    if (entry.claude !== undefined && !wrote) {
      answered = answered.filter((each) => !(each.path === path && each.keys[0] === digest));
      answered.push({ at, path, keys: [digest, ...keys] });
    }
  }
  for (const action of entry.done) if (action.kind === 'archived') paths.delete(action.from);
  return { ...ledger, paths, answered };
}

/**
 * The ledger a log without one implies: its entries, once. A log already full
 * may have dropped entries before this, so it vouches only from its oldest.
 */
export function ledgerFromEntries(entries: readonly LogEntry[], keep: number): HandledLedger {
  let ledger = emptyLedger();
  for (const entry of entries) {
    if (entry.kind === 'run') ledger = recordRun(ledger, entry, localTimeMs(entry.at) ?? 0);
  }
  const oldest = entries[0];
  const full = entries.length >= keep && oldest !== undefined;
  return full ? { ...ledger, vouchesFrom: localTimeMs(oldest.at) ?? 0 } : ledger;
}

/**
 * What a rule remembers now: its ledger, which is brought up to date with
 * every entry written and so is not to be laid over by the entries still in
 * the log (that would bring back what it let go); a log with none implies one.
 */
export function ledgerNow(
  ledger: HandledLedger | null,
  entries: readonly LogEntry[],
  keep: number,
): HandledLedger {
  return ledger ?? ledgerFromEntries(entries, keep);
}

type Forgettable =
  | { readonly at: number; readonly path: string }
  | { readonly at: number; readonly answered: AnsweredRecord };

/** The ledger without what is older than {@link LEDGER_MAX_AGE_DAYS} or past the count, and the floor that leaves. */
export function pruneLedger(
  ledger: HandledLedger,
  now: number,
  { maxRecords = MAX_LEDGER_RECORDS }: { maxRecords?: number } = {},
): HandledLedger {
  const records: Forgettable[] = [
    ...[...ledger.paths].map(([path, { at }]) => ({ at, path })),
    ...ledger.answered.map((answered) => ({ at: answered.at, answered })),
  ].sort((a, b) => a.at - b.at);
  const cutoff = now - LEDGER_MAX_AGE_DAYS * DAY_MS;
  const tooOld = records.filter((record) => record.at < cutoff).length;
  const forgotten = records.slice(0, Math.max(tooOld, records.length - maxRecords));
  if (forgotten.length === 0) return ledger;
  const paths = new Map(ledger.paths);
  const answered = new Set(ledger.answered);
  for (const record of forgotten) {
    if ('path' in record) paths.delete(record.path);
    else answered.delete(record.answered);
  }
  // Nothing last written before the newest thing forgotten can be vouched for.
  const floor = Math.max(...forgotten.map((record) => record.at));
  return {
    vouchesFrom: Math.max(ledger.vouchesFrom ?? floor, floor),
    paths,
    answered: [...answered],
  };
}

const instant = (at: number): string => new Date(at).toISOString();

/** The section the log holds, which {@link readHandledLedger} reads back; empty when there is nothing to say. */
export function formatLedger(ledger: HandledLedger): string {
  const lines = [
    ...(ledger.vouchesFrom === null ? [] : [`- vouches from ${code(instant(ledger.vouchesFrom))}`]),
    ...[...ledger.paths]
      .sort(([, a], [, b]) => a.at - b.at)
      .map(
        ([path, { at, digests }]) =>
          `- handled ${code(path)} ${code(instant(at))}: ${code(digests)}`,
      ),
    ...[...ledger.answered]
      .sort((a, b) => a.at - b.at)
      .map(({ path, at, keys }) => `- answered ${code(path)} ${code(instant(at))}: ${code(keys)}`),
  ];
  if (lines.length === 0) return '';
  return `${LEDGER_HEADING}\n\n${LEDGER_NOTE}\n\n${lines.join('\n')}\n`;
}

export const isLedgerSection = (section: string): boolean =>
  section.split('\n', 1)[0]!.trim() === LEDGER_HEADING;

const VOUCHES_LINE = new RegExp(`^- vouches from ${JSON_SPAN}$`);
const HANDLED_LINE = new RegExp(`^- handled ${JSON_SPAN} ${JSON_SPAN}: ${JSON_SPAN}$`);
const ANSWERED_LINE = new RegExp(`^- answered ${JSON_SPAN} ${JSON_SPAN}: ${JSON_SPAN}$`);

/** The ledger a section holds. A line that does not read — a person may have edited it — is left out. */
export function parseLedger(section: string): HandledLedger {
  let vouchesFrom: number | null = null;
  const paths = new Map<string, PathRecord>();
  const answered: AnsweredRecord[] = [];
  for (const line of section.split('\n').map((each) => each.trim())) {
    try {
      const vouches = VOUCHES_LINE.exec(line);
      if (vouches !== null) vouchesFrom = timeOf(vouches[1]!);
      const handled = HANDLED_LINE.exec(line);
      if (handled !== null) {
        const path = pathOf(handled[1]!);
        paths.set(path, { at: timeOf(handled[2]!), digests: stringsOf(handled[3]!) });
      }
      const answer = ANSWERED_LINE.exec(line);
      if (answer !== null) {
        const keys = stringsOf(answer[3]!);
        if (keys.length > 0) {
          answered.push({
            path: createVaultPath(pathOf(answer[1]!)),
            at: timeOf(answer[2]!),
            keys,
          });
        }
      }
    } catch {
      // A line edited into something that does not read is left out, as any other log line is.
    }
  }
  return { vouchesFrom, paths, answered };
}

function pathOf(json: string): string {
  const value = JSON.parse(json) as unknown;
  if (typeof value !== 'string') throw new Error('not a path');
  return createVaultPath(value);
}

function timeOf(json: string): number {
  const value = JSON.parse(json) as unknown;
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) throw new Error('not a time');
  return at;
}

function stringsOf(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value) || !value.every((each) => typeof each === 'string')) {
    throw new Error('not a list of words');
  }
  return value as string[];
}

/** The ledger a log's text holds; null when it holds none (a log from before the ledger). */
export function readHandledLedger(text: string | null): HandledLedger | null {
  if (text === null) return null;
  const start = text.split('\n').findIndex((line) => line.trim() === LEDGER_HEADING);
  if (start === -1) return null;
  const rest = text.split('\n').slice(start);
  const end = rest.findIndex((line, at) => at > 0 && line.startsWith('## '));
  return parseLedger((end === -1 ? rest : rest.slice(0, end)).join('\n'));
}
