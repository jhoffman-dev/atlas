import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  emptyLedger,
  formatLedger,
  LEDGER_MAX_BYTES,
  MAX_DIGESTS_PER_PATH,
  pruneLedger,
  readHandledLedger,
  recordRun,
} from './handled-ledger.ts';
import { handledVersions, missedArrivals, type NoteTrigger } from './note-trigger.ts';
import {
  appendEntryToLog,
  appendLogEntry,
  formatLogEntry,
  MAX_LOG_ENTRIES,
  newLogText,
  parseRunLog,
  type LogEntry,
} from './run-log.ts';
import { localTimeMs, localTimeOf } from './schedule.ts';

const p = createVaultPath;
const ON_CREATED: NoteTrigger = { kind: 'note', type: 'meeting', on: ['created'] };
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

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
const letGo = (n: number): Extract<LogEntry, { kind: 'letGo' }> => ({
  kind: 'letGo',
  at: minute(n),
  count: 1,
});

/** Appends as Atlas does: at the instant the clock gives, which by default is the entry's wall time read as UTC. */
const append = (
  text: string | null,
  entry: LogEntry,
  extra: Partial<Parameters<typeof appendLogEntry>[0]> = {},
): string =>
  appendLogEntry({ text, ruleName: 'Brief', entry, now: localTimeMs(entry.at)!, ...extra });
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
    expect(missedArrivals({ trigger: ON_CREATED, notes: fresh, handled, since: 0 })).toHaveLength(
      1,
    );
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

    // Wall time has no zone: the earliest instant it could be is 14 hours before it read as UTC.
    const earliest = Date.UTC(2026, 6, 1) - 14 * HOUR_MS;
    expect(memoryOf(full).vouchesFrom).toBe(earliest);
    const next = append(full, answeredRun(MAX_LOG_ENTRIES));
    expect(memoryOf(next).vouchesFrom).toBe(earliest);
  });

  it('forgets a path the log says went, and a path the rule archived, as the entries do', () => {
    const base: Run = {
      kind: 'run',
      at: minute(0),
      trigger: 'note',
      done: [],
      left: [],
      capped: false,
    };
    const handledOnly: Run = {
      ...base,
      versions: [{ path: meetingPath(0), digest: 'd0', wrote: false }],
    };
    const text = appendAll([handledOnly, { ...base, at: minute(1), went: [meetingPath(0)] }]);

    expect(memoryOf(text).hasPath(meetingPath(0))).toBe(false);
  });

  it('records more than one key for a handled version, and matches a note on any of them', () => {
    const entry = answeredRun(0, {
      versions: [
        { path: meetingPath(0), digest: 'd0', wrote: false, keys: ['meeting:fathom:abc:body:abc'] },
      ],
    });
    const text = appendAll([entry]);

    expect(text).toContain('also');
    expect(parseRunLog(text)[0]).toEqual(entry);
    const handled = memoryOf(text);
    const elsewhere = {
      path: p('Filed/Renamed.md'),
      digest: 'edited',
      keys: ['meeting:fathom:abc:body:abc'],
    };
    expect(handled.has(elsewhere)).toBe(true);
    expect(handled.has({ ...elsewhere, keys: ['meeting:fathom:abc:body:other'] })).toBe(false);
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
    const damaged = text.replace(/^- handled .*$/m, '- handled not json');

    const handled = memoryOf(damaged);
    expect(handled.has({ path: meetingPath(0), digest: 'd0' })).toBe(true);
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

const BASE = Date.UTC(2026, 9, 8, 12);
const JULY_2 = Date.UTC(2026, 6, 2);
const wall = (instant: number, offsetHours: number): string =>
  localTimeOf(instant + offsetHours * HOUR_MS);
const headings = (text: string): number =>
  text.split('\n').filter((line) => line === '## Handled so far').length;
/** The log's text up to its first entry: its head and the ledger. */
const upToEntries = (text: string): string => text.slice(0, text.search(/^## \d{4}-/m));

describe.each([
  ['west of UTC (-7)', -7],
  ['east of UTC (+9)', 9],
])('ledger times are true instants, %s', (_, offset) => {
  const handledAt = (n: number, instant: number): Run =>
    answeredRun(n, { at: wall(instant, offset) });
  const first = BASE + 2 * HOUR_MS;
  const second = BASE + 5 * HOUR_MS;
  const twoHandled = (): string => {
    const text = append(null, handledAt(0, first), { now: first, maxLedgerRecords: 2 });
    return append(text, handledAt(1, second), { now: second, maxLedgerRecords: 2 });
  };

  it('still vouches for a meeting handled hours after it was written, once pruned', () => {
    const handled = memoryOf(twoHandled());

    expect(handled.vouchesFrom).toBe(first);
    const written = meetingsHeld(1, BASE);
    expect(missedArrivals({ trigger: ON_CREATED, notes: written, handled, since: 0 })).toEqual([]);
  });

  it('leaves no window in which a meeting written after the floor is never asked', () => {
    const late = {
      path: p('Inbox/Meetings/Late.md'),
      digest: 'late',
      type: 'meeting',
      importOutcome: 'imported',
      modified: first + HOUR_MS,
    };

    const missed = missedArrivals({
      trigger: ON_CREATED,
      notes: [late],
      handled: memoryOf(twoHandled()),
      since: 0,
    });
    expect(missed.map((each) => each.path)).toEqual([late.path]);
  });

  it('writes the record time as a real UTC instant, not the wall time', () => {
    const text = append(null, handledAt(0, BASE), { now: BASE });

    expect(text).toContain(`\`"${new Date(BASE).toISOString()}"\``);
  });
});

describe('a ledger and the entries a pre-ledger Atlas added after it', () => {
  const oldAtlasAppends = (text: string, entry: LogEntry): string =>
    `${text.replace(/\n*$/, '\n')}\n${formatLogEntry(entry)}`;

  it('lays a newer run over the ledger, on read', () => {
    const text = oldAtlasAppends(append(null, answeredRun(0)), answeredRun(1));

    const handled = memoryOf(text);
    expect(handled.has({ path: meetingPath(1), digest: 'd1' })).toBe(true);
    expect(handled.has({ path: meetingPath(0), digest: 'd0' })).toBe(true);
  });

  it('folds it into the ledger on the next append, and stamps what it folded in', () => {
    const behind = oldAtlasAppends(append(null, answeredRun(0)), answeredRun(1));
    const text = append(behind, answeredRun(2));

    const ledger = readHandledLedger(text)!;
    expect([...ledger.paths.keys()].sort()).toEqual([0, 1, 2].map(meetingPath));
    expect(text).toMatch(/^- through `"[^"]+"` `"[0-9a-f]{8}"`$/m);
  });

  it('does not bring back what the ledger pruned, though its entry is still in the log', () => {
    let text: string | null = null;
    for (const at of [0, 1, 2]) text = append(text, answeredRun(at), { maxLedgerRecords: 2 });
    expect(parseRunLog(text!)).toHaveLength(3);
    expect(memoryOf(text!).hasPath(meetingPath(0))).toBe(false);

    const handled = memoryOf(oldAtlasAppends(text!, answeredRun(3)));
    expect(handled.hasPath(meetingPath(3))).toBe(true);
    expect(handled.hasPath(meetingPath(0))).toBe(false);
  });

  it('lays over only entries after the stamped time when the stamped entry is gone', () => {
    let text: string | null = null;
    for (const at of [0, 1, 2]) text = append(text, answeredRun(at), { maxLedgerRecords: 2 });
    // The stamped entry (2) and the oldest (0) were dropped by an Atlas that keeps fewer.
    const kept = [answeredRun(1), answeredRun(3)].map(formatLogEntry).join('\n');
    const handled = memoryOf(`${upToEntries(text!)}${kept}`);

    expect(handled.hasPath(meetingPath(3))).toBe(true);
    expect(handled.hasPath(meetingPath(0))).toBe(false);
    expect(handled.hasPath(meetingPath(2))).toBe(true);
  });
});

describe('a damaged ledger', () => {
  const twoRuns = (): string => appendAll([answeredRun(0), answeredRun(1)]);
  const lostLine = (): string => twoRuns().replace(/^- handled .*M0\.md.*\n/m, '');

  it('recovers what the entries still say when a line was lost', () => {
    const handled = memoryOf(lostLine());

    expect(handled.hasPath(meetingPath(0))).toBe(true);
    expect(handled.hasPath(meetingPath(1))).toBe(true);
  });

  it('vouches for nothing yet, rather than for everything it no longer knows', () => {
    const handled = memoryOf(lostLine());

    expect(handled.vouchesFrom).toBe(Number.POSITIVE_INFINITY);
    const notes = meetingsHeld(5, Date.UTC(2099, 0, 1)).slice(2);
    expect(missedArrivals({ trigger: ON_CREATED, notes, handled, since: 0 })).toEqual([]);
  });

  it('treats a line that does not read as damage too', () => {
    const unreadable = twoRuns().replace(/^- answered .*$/m, '- answered not json');

    expect(memoryOf(unreadable).vouchesFrom).toBe(Number.POSITIVE_INFINITY);
  });

  it('is repaired on the next append: it vouches from that moment, and says so once', () => {
    const now = Date.UTC(2026, 6, 2);

    const first = appendEntryToLog({ text: lostLine(), ruleName: 'Brief', entry: letGo(5), now });
    expect(first.ledgerRepaired).toBe(true);
    expect(memoryOf(first.text).vouchesFrom).toBe(now);
    expect(memoryOf(first.text).hasPath(meetingPath(0))).toBe(true);
    const second = appendEntryToLog({ text: first.text, ruleName: 'Brief', entry: letGo(6), now });
    expect(second.ledgerRepaired).toBe(false);
    expect(memoryOf(second.text).vouchesFrom).toBe(now);
  });

  it('does not count an intact ledger as damaged', () => {
    const entry = letGo(9);
    const result = appendEntryToLog({ text: twoRuns(), ruleName: 'Brief', entry, now: BASE });

    expect(result.ledgerRepaired).toBe(false);
  });
});

describe('finding the ledger in a log', () => {
  it('names its format and version on the line after the heading', () => {
    const text = append(null, answeredRun(0));

    expect(text).toMatch(/^## Handled so far\n<!-- atlas:handled-ledger v1 -->\n/m);
  });

  it('does not take an indented heading for the ledger, in the reader or the writer', () => {
    const text = append(null, answeredRun(0));
    const indented = text.replace('## Handled so far', '  ## Handled so far');

    expect(readHandledLedger(indented)).toBeNull();
    const next = append(indented, answeredRun(1));
    expect(headings(next)).toBe(1);
    expect(readHandledLedger(next)?.paths.size).toBe(2);
  });

  it('merges two ledgers into one, and says it repaired', () => {
    const a = appendAll([answeredRun(0)]);
    const b = appendAll([answeredRun(1)]);
    const both = `${a}\n${b.slice(b.indexOf('## Handled so far'))}`;
    expect(headings(both)).toBe(2);

    const result = appendEntryToLog({
      text: both,
      ruleName: 'Brief',
      entry: letGo(7),
      now: JULY_2,
    });
    expect(headings(result.text)).toBe(1);
    expect(result.ledgerRepaired).toBe(true);
    expect(memoryOf(result.text).hasPath(meetingPath(0))).toBe(true);
    expect(memoryOf(result.text).hasPath(meetingPath(1))).toBe(true);
  });

  it('leaves a person’s own "Handled so far" section alone, never reads it, and keeps it', () => {
    const own = [
      '## Handled so far',
      '',
      '- handled `"Inbox/Meetings/Mine.md"` `"2026-07-01T00:00:00.000Z"`: `["mine"]`',
      '',
    ].join('\n');
    const start = `${newLogText('Brief', [])}${own}`;

    expect(readHandledLedger(start)).toBeNull();
    expect(memoryOf(start).hasPath(p('Inbox/Meetings/Mine.md'))).toBe(false);
    const next = append(start, answeredRun(0));
    expect(next).toContain(own);
    expect(readHandledLedger(next)?.paths.has('Inbox/Meetings/Mine.md')).toBe(false);
    expect(readHandledLedger(next)?.paths.has(meetingPath(0))).toBe(true);
    const again = append(next, answeredRun(1));
    expect(again).toContain(own);
    expect(readHandledLedger(again)?.paths.size).toBe(2);
  });

  it('reads a ledger of a future version as unreadable, and replaces it with one of its own', () => {
    const text = append(null, answeredRun(0)).replace('ledger v1', 'ledger v2');
    const result = appendEntryToLog({ text, ruleName: 'Brief', entry: letGo(3), now: BASE });

    expect(result.ledgerRepaired).toBe(true);
    expect(headings(result.text)).toBe(1);
    expect(result.text).toContain('atlas:handled-ledger v1');
    expect(result.text).not.toContain('atlas:handled-ledger v2');
  });
});

describe('how much a ledger holds', () => {
  const answered = (n: number, keys: string[] = []): Run =>
    answeredRun(n, {
      at: minute(n),
      versions: [
        {
          path: p(`Inbox/Meetings/${'A long folder name '.repeat(3)}${n}.md`),
          digest: `d${n}`,
          wrote: false,
          keys,
        },
      ],
    });

  it('holds at most 5 versions of a note, the newest', () => {
    const runs = Array.from({ length: 9 }, (_, v) =>
      answeredRun(0, {
        at: minute(v),
        versions: [{ path: meetingPath(0), digest: `v${v}`, wrote: false }],
      }),
    );
    const text = appendAll(runs);

    expect(MAX_DIGESTS_PER_PATH).toBe(5);
    expect(readHandledLedger(text)!.paths.get(meetingPath(0))!.digests).toEqual([
      'v4',
      'v5',
      'v6',
      'v7',
      'v8',
    ]);
  });

  it('prunes the oldest first to stay within its bytes, and floors at the newest it let go', () => {
    let ledger = emptyLedger();
    const count = 1500;
    for (let n = 0; n < count; n += 1) {
      ledger = recordRun(ledger, answered(n), BASE + n * 60_000);
    }
    expect(Buffer.byteLength(formatLedger(ledger))).toBeGreaterThan(LEDGER_MAX_BYTES);

    const pruned = pruneLedger(ledger, BASE + count * 60_000);
    const size = Buffer.byteLength(formatLedger(pruned));
    expect(size).toBeLessThanOrEqual(LEDGER_MAX_BYTES);
    expect(size).toBeGreaterThan(LEDGER_MAX_BYTES - 1024);
    expect(pruned.paths.has(answered(count - 1).versions![0]!.path)).toBe(true);
    expect(pruned.paths.has(answered(0).versions![0]!.path)).toBe(false);
    expect(pruned.vouchesFrom).toBe(BASE + (count - pruned.paths.size - 1) * 60_000);
  });

  it('leaves a ledger exactly at its bound as it is, and trims one byte over', () => {
    let ledger = emptyLedger();
    for (let n = 0; n < 300; n += 1) ledger = recordRun(ledger, answered(n), BASE + n * 60_000);
    const size = Buffer.byteLength(formatLedger(ledger));
    const now = BASE + 301 * 60_000;

    expect(pruneLedger(ledger, now, { maxBytes: size })).toBe(ledger);
    expect(pruneLedger(ledger, now, { maxBytes: size - 1 }).paths.size).toBeLessThan(300);
  });

  it('counts the ledger within the log’s own bytes', () => {
    const runs = Array.from({ length: 10 }, (_, n) => answeredRun(n));
    const ledgerBytes = Buffer.byteLength(formatLedger(readHandledLedger(appendAll(runs))!));
    const entryBytes = Buffer.byteLength(formatLogEntry(answeredRun(9)));
    const maxBytes = Buffer.byteLength(newLogText('Brief', [])) + ledgerBytes + entryBytes * 3;

    const tight = runs.reduce<string | null>(
      (log, entry) => append(log, entry, { maxBytes }),
      null,
    )!;
    expect(parseRunLog(tight).length).toBeLessThanOrEqual(3);
    expect(readHandledLedger(tight)!.paths.size).toBe(10);
  });
});

describe('the keys a schema gives a version', () => {
  const key = 'meeting:fathom:abc:body:9f8e';
  const withKeys = (keys: string[]): Run =>
    answeredRun(0, { versions: [{ path: meetingPath(0), digest: 'd0', wrote: false, keys }] });

  it('keeps only keys of a usable shape: non-empty on both sides of a colon', () => {
    const text = append(null, withKeys([key, 'bare', '', ':', 'x:']));

    expect(readHandledLedger(text)!.answered[0]!.keys).toEqual(['d0', key]);
  });

  it('does not match a version on a key of the wrong shape', () => {
    const handled = memoryOf(append(null, withKeys(['bare'])));

    expect(handled.has({ path: p('Elsewhere.md'), digest: 'other', keys: ['bare'] })).toBe(false);
  });

  it('does not take a note of the same words in another meeting for the one answered', () => {
    const handled = memoryOf(append(null, withKeys([key])));

    const other = {
      path: p('Filed/Other.md'),
      digest: 'x',
      keys: ['meeting:fathom:zzz:body:9f8e'],
    };
    expect(handled.has(other)).toBe(false);
  });

  it('is honoured by catch-up, which hands the keys on', () => {
    const handled = memoryOf(append(null, withKeys([key])));
    const note = (keys: string[]) => ({
      path: p('Inbox/Meetings/Renamed.md'),
      digest: 'edited',
      type: 'meeting',
      importOutcome: 'imported',
      modified: BASE,
      keys,
    });
    const missed = (keys: string[]) =>
      missedArrivals({ trigger: ON_CREATED, notes: [note(keys)], handled, since: 0 });

    expect(missed([key])).toEqual([]);
    const fresh = 'meeting:fathom:new:body:1111';
    expect(missed([fresh])).toEqual([
      { path: p('Inbox/Meetings/Renamed.md'), digest: 'edited', keys: [fresh] },
    ]);
  });
});

describe('pruning does not trust a time later than the clock', () => {
  it('keeps what the clock says is recent, however late the entry claims to be', () => {
    let text = append(null, answeredRun(0, { at: wall(BASE, 0) }), { now: BASE });
    const bogus = answeredRun(1, { at: wall(BASE + 200 * DAY_MS, 0) });
    text = append(text, bogus, { now: BASE + DAY_MS });

    const handled = memoryOf(text);
    expect(handled.hasPath(meetingPath(0))).toBe(true);
    expect(handled.vouchesFrom).toBeNull();
  });

  it('never floors catch-up later than the clock', () => {
    const runs = Array.from({ length: 3 }, (_, n) =>
      answeredRun(n, { at: wall(BASE + 400 * DAY_MS, 0) }),
    );
    const text = runs.reduce<string | null>(
      (log, entry) => append(log, entry, { now: BASE, maxLedgerRecords: 1 }),
      null,
    )!;

    expect(memoryOf(text).vouchesFrom!).toBeLessThanOrEqual(BASE);
  });

  it('never floors catch-up later than the clock, even for a record dated after it', () => {
    let ledger = emptyLedger();
    for (let n = 0; n < 3; n += 1) ledger = recordRun(ledger, answeredRun(n), BASE + 5 * DAY_MS);

    expect(pruneLedger(ledger, BASE, { maxRecords: 1 }).vouchesFrom).toBe(BASE);
  });
});
