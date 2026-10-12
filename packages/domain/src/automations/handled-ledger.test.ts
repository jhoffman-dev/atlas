import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { readHandledLedger } from './handled-ledger.ts';
import { handledVersions, missedArrivals, type NoteTrigger } from './note-trigger.ts';
import { appendLogEntry, MAX_LOG_ENTRIES, newLogText, parseRunLog, type LogEntry } from './run-log.ts';

const p = createVaultPath;
const ON_CREATED: NoteTrigger = { kind: 'note', type: 'meeting', on: ['created'] };
const DAY_MS = 86_400_000;

type Run = Extract<LogEntry, { kind: 'run' }>;
const minute = (n: number): string =>
  new Date(Date.UTC(2026, 6, 1) + n * 60_000).toISOString().slice(0, 19);

const meetingPath = (n: number) => p(`Inbox/Meetings/M${n}.md`);
const answeredRun = (n: number, extra: Partial<Run> = {}): Run => ({
  kind: 'run',
  at: minute(n),
  trigger: 'note',
  done: [],
  left: [],
  capped: false,
  versions: [{ path: meetingPath(n), digest: `d${n}`, wrote: false }],
  claude: { model: 'claude-opus-5-5', ms: 10 },
  ...extra,
});
const letGo = (n: number): LogEntry => ({ kind: 'letGo', at: minute(n), count: 1 });

const append = (text: string | null, entry: LogEntry, extra = {}): string =>
  appendLogEntry({ text, ruleName: 'Brief', entry, ...extra });
const appendAll = (entries: readonly LogEntry[], text: string | null = null): string =>
  entries.reduce<string | null>((log, entry) => append(log, entry), text) ?? '';

/** What a rule would read of its log now. */
const memoryOf = (text: string) =>
  handledVersions(parseRunLog(text), { ledger: readHandledLedger(text) });

const meetingsHeld = (count: number, modified: number) =>
  Array.from({ length: count }, (_, at) => ({
    path: meetingPath(at),
    digest: `d${at}`,
    type: 'meeting',
    importOutcome: 'imported',
    modified,
  }));

describe('the handled ledger: what a rule remembers once its entries age out', () => {
  it('still vouches for 150 handled meetings, and asks about none at open, with 100 entries kept', () => {
    const text = appendAll(Array.from({ length: 150 }, (_, at) => answeredRun(at)));

    expect(parseRunLog(text)).toHaveLength(MAX_LOG_ENTRIES);
    const handled = memoryOf(text);
    const again = missedArrivals({
      trigger: ON_CREATED,
      notes: meetingsHeld(150, 5_000),
      handled,
      since: 0,
    });
    expect(again).toEqual([]);
    expect(handled.hasPath(meetingPath(0))).toBe(true);
    expect(handled.has({ path: meetingPath(0), digest: 'd0' })).toBe(true);
  });

  it('keeps the handled set when 60 let-go notices and 50 runs pass through the log', () => {
    const first = Array.from({ length: 50 }, (_, at) => answeredRun(at));
    const noise = Array.from({ length: 60 }, (_, at) => letGo(100 + at));
    const more = Array.from({ length: 50 }, (_, at) => answeredRun(50 + at));
    const text = appendAll([...first, ...noise, ...more]);

    const handled = memoryOf(text);
    for (let at = 0; at < 100; at += 1) {
      expect(handled.has({ path: meetingPath(at), digest: `d${at}` })).toBe(true);
    }
  });

  it('folds consecutive let-go notices into one that sums their count', () => {
    const text = appendAll([answeredRun(0), letGo(1), letGo(2), { ...letGo(3), count: 3 }]);

    const entries = parseRunLog(text);
    expect(entries.map((entry) => entry.kind)).toEqual(['run', 'letGo']);
    expect(entries[1]).toEqual({ kind: 'letGo', at: minute(3), count: 5 });
  });

  it('does not fold a let-go notice into a run between two of them', () => {
    const text = appendAll([letGo(1), answeredRun(2), letGo(3)]);

    expect(parseRunLog(text).map((entry) => entry.kind)).toEqual(['letGo', 'run', 'letGo']);
  });

  it('forgets what is older than 90 days, and vouches only for what came after', () => {
    const old = answeredRun(0);
    const recent = answeredRun(95 * 24 * 60);
    const text = appendAll([old, recent]);

    const handled = memoryOf(text);
    expect(handled.has({ path: meetingPath(0), digest: 'd0' })).toBe(false);
    expect(handled.has({ path: meetingPath(95 * 24 * 60), digest: `d${95 * 24 * 60}` })).toBe(true);
    // A meeting last written before that cannot be vouched for: it is not asked about.
    expect(handled.vouchesFrom).toBe(Date.UTC(2026, 6, 1));
    const notes = meetingsHeld(1, Date.UTC(2026, 6, 1) - DAY_MS);
    expect(missedArrivals({ trigger: ON_CREATED, notes, handled, since: 0 })).toEqual([]);
  });

  it('prunes the oldest past its count, and floors catch-up at the newest it let go', () => {
    const capped = [0, 1, 2, 3, 4, 5, 6, 7].reduce<string | null>(
      (log, at) => append(log, answeredRun(at), { maxLedgerRecords: 6 }),
      null,
    )!;
    const handled = memoryOf(capped);
    expect(handled.has({ path: meetingPath(7), digest: 'd7' })).toBe(true);
    expect(handled.has({ path: meetingPath(0), digest: 'd0' })).toBe(false);
    const floor = handled.vouchesFrom!;
    expect(floor).toBeGreaterThan(Date.UTC(2026, 6, 1));
    const stale = meetingsHeld(1, floor - 1);
    expect(missedArrivals({ trigger: ON_CREATED, notes: stale, handled, since: 0 })).toEqual([]);
    const fresh = meetingsHeld(1, floor + 60_000).map((note) => ({ ...note, digest: 'new' }));
    expect(missedArrivals({ trigger: ON_CREATED, notes: fresh, handled, since: 0 })).toHaveLength(1);
  });

  it('never floors catch-up when nothing was pruned', () => {
    const handled = memoryOf(appendAll([answeredRun(0)]));

    expect(handled.vouchesFrom).toBeNull();
  });

  it('builds the ledger once from an old-format log with no ledger, and behaves as before', () => {
    const old = newLogText('Brief', [answeredRun(0), answeredRun(1)]);
    expect(readHandledLedger(old)).toBeNull();
    expect(memoryOf(old).has({ path: meetingPath(1), digest: 'd1' })).toBe(true);

    const next = append(old, answeredRun(2));
    expect(readHandledLedger(next)).not.toBeNull();
    const handled = memoryOf(next);
    for (const at of [0, 1, 2]) {
      expect(handled.has({ path: meetingPath(at), digest: `d${at}` })).toBe(true);
    }
    expect(handled.vouchesFrom).toBeNull();
  });

  it('floors an old-format log that was already full at its oldest entry', () => {
    const full = newLogText(
      'Brief',
      Array.from({ length: MAX_LOG_ENTRIES }, (_, at) => answeredRun(at)),
    );

    expect(memoryOf(full).vouchesFrom).toBe(Date.UTC(2026, 6, 1));
    const next = append(full, answeredRun(MAX_LOG_ENTRIES));
    expect(memoryOf(next).vouchesFrom).toBe(Date.UTC(2026, 6, 1));
  });

  it('forgets a path the log says went, and a path the rule archived, as the entries do', () => {
    const text = appendAll([
      answeredRun(0, { claude: undefined }),
      { ...answeredRun(1, { claude: undefined }), versions: undefined, went: [meetingPath(0)] },
    ]);

    expect(memoryOf(text).hasPath(meetingPath(0))).toBe(false);
  });

  it('records more than one key for a handled version, and matches a note on any of them', () => {
    const entry = answeredRun(0, {
      versions: [{ path: meetingPath(0), digest: 'd0', wrote: false, keys: ['body:abc'] }],
    });
    const text = appendAll([entry]);

    expect(text).toContain('also');
    expect(parseRunLog(text)[0]).toEqual(entry);
    const handled = memoryOf(text);
    const elsewhere = { path: p('Filed/Renamed.md'), digest: 'edited', keys: ['body:abc'] };
    expect(handled.has(elsewhere)).toBe(true);
    expect(handled.has({ ...elsewhere, keys: ['body:other'] })).toBe(false);
  });

  it('keeps a reader’s own section and the entries, and writes a ledger a person can read', () => {
    const own = '## My notes\n\nKeep me.\n';
    const text = append(`${newLogText('Brief', [])}${own}`, answeredRun(0));

    expect(text).toContain('Keep me.');
    expect(text).toMatch(/^## Handled so far$/m);
    expect(text).toContain('"Inbox/Meetings/M0.md"');
    expect(parseRunLog(text)).toHaveLength(1);
  });

  it('leaves a ledger line that does not read out, and reads the rest', () => {
    const text = append(null, answeredRun(0));
    const damaged = text.replace(/^- at .*$/m, '- at not json');

    const handled = memoryOf(damaged);
    expect(handled.has({ path: meetingPath(0), digest: 'd0' })).toBe(true);
    expect(handled.hasPath(meetingPath(0))).toBe(false);
  });

  it('does not let a failed or undone entry touch the ledger', () => {
    const text = appendAll([
      answeredRun(0),
      { kind: 'failed', at: minute(1), trigger: 'note', problem: 'No.' },
      { kind: 'undo', at: minute(2), of: minute(0), done: [], left: [] },
    ]);

    expect(memoryOf(text).has({ path: meetingPath(0), digest: 'd0' })).toBe(true);
  });
});
