/**
 * The answers the declared step keeps in its rule's ledger (ADR-0036, "The
 * model's answer is kept and reused"): written with a failed run's entry,
 * read back exactly, gone once the words are answered, and bounded on their
 * own so they never crowd out what was handled.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { utf8Length } from './log-sections.ts';
import {
  emptyLedger,
  formatLedger,
  LEDGER_MAX_AGE_DAYS,
  MAX_STORED_ANSWERS,
  pruneLedger,
  readHandledLedger,
  recordRun,
  recordStored,
  STORED_ANSWERS_MAX_BYTES,
  storedAnswerFor,
  type StoredAnswerDraft,
} from './handled-ledger.ts';
import { appendEntryToLog, type LogEntry } from './run-log.ts';
import { localTimeMs } from './schedule.ts';

const DAY_MS = 86_400_000;
const KEY = 'meeting:granola:granola-5c1d:transcript:9f8e';
const MEETING = createVaultPath('Meetings/2026-10-14 Renewal review.md');
/** An answer as a model words it: quotes, a backtick, a line break and a fence round it. */
const ANSWER =
  '```json\n{"items":[{"kind":"task","title":"Send the `v2` contract","owner":"You"}]}\n```';

const at = (minute: number) => `2026-10-14T09:${String(minute).padStart(2, '0')}:00`;
const failed = (minute: number): LogEntry => ({
  kind: 'failed',
  at: at(minute),
  trigger: 'note',
  problem: 'Made 1 of 2 tasks, then one could not be made: the disk is full.',
  claude: { model: 'claude-sonnet-5-5', ms: 10, asks: 1 },
});
const answered = (minute: number, keys: readonly string[] = [KEY]): LogEntry => ({
  kind: 'run',
  at: at(minute),
  trigger: 'hand',
  done: [],
  left: [],
  capped: false,
  versions: [{ path: MEETING, digest: `d${minute}`, wrote: false, keys: [...keys] }],
  claude: { model: 'claude-sonnet-5-5', ms: 10 },
});

const append = (text: string | null, entry: LogEntry, stored?: readonly StoredAnswerDraft[]) =>
  appendEntryToLog({
    text,
    ruleName: 'After a meeting',
    entry,
    now: localTimeMs(entry.at)!,
    ...(stored !== undefined && { stored }),
  }).text;

describe('an answer kept with a failed run', () => {
  it('is read back exactly as the model gave it, by the key of the words it answered', () => {
    const text = append(null, failed(0), [{ key: KEY, answers: [ANSWER, '{"items":[]}'] }]);

    const ledger = readHandledLedger(text);
    expect(ledger?.damaged).toBe(false);
    expect(storedAnswerFor(ledger, KEY)?.answers).toEqual([ANSWER, '{"items":[]}']);
    expect(storedAnswerFor(ledger, `${KEY}0`)).toBeNull();
    expect(storedAnswerFor(null, KEY)).toBeNull();
  });

  it('stays through later entries, and is replaced by a newer answer to the same words', () => {
    let text = append(null, failed(0), [{ key: KEY, answers: ['first'] }]);
    text = append(text, failed(1));
    expect(storedAnswerFor(readHandledLedger(text), KEY)?.answers).toEqual(['first']);

    text = append(text, failed(2), [{ key: KEY, answers: ['second'] }]);

    const ledger = readHandledLedger(text)!;
    expect(ledger.stored).toHaveLength(1);
    expect(storedAnswerFor(ledger, KEY)?.answers).toEqual(['second']);
  });

  it('is let go once a run has answered those words, and only those', () => {
    const other = 'meeting:granola:granola-7e2f:transcript:1a2b';
    let text = append(null, failed(0), [
      { key: KEY, answers: ['kept'] },
      { key: other, answers: ['other'] },
    ]);

    text = append(text, answered(1));

    const ledger = readHandledLedger(text)!;
    expect(storedAnswerFor(ledger, KEY)).toBeNull();
    expect(storedAnswerFor(ledger, other)?.answers).toEqual(['other']);
  });

  it('is not kept without answers, or under a key that names no note', () => {
    const ledger = recordStored(
      emptyLedger(),
      [
        { key: KEY, answers: [] },
        { key: 'transcript-only', answers: ['an answer'] },
      ],
      0,
    );

    expect(ledger.stored).toEqual([]);
  });

  it('counts among the records, so a stored line lost or edited is damage', () => {
    const text = append(null, failed(0), [{ key: KEY, answers: ['kept'] }]);
    const line = text.split('\n').find((each) => each.startsWith('- stored '))!;

    expect(readHandledLedger(text.replace(`${line}\n`, ''))?.damaged).toBe(true);
    expect(readHandledLedger(text.replace(line, line.replace('["kept"]', '[]')))?.damaged).toBe(
      true,
    );
    expect(readHandledLedger(text.replace(line, line.replace(KEY, 'no-colon')))?.damaged).toBe(
      true,
    );
  });
});

describe('how many answers a ledger keeps', () => {
  const NOW = Date.UTC(2026, 9, 14);
  const stored = (count: number, size = 10) =>
    recordStored(
      emptyLedger(),
      Array.from({ length: count }, (_, n) => ({ key: `${KEY}${n}`, answers: ['x'.repeat(size)] })),
      NOW,
    );
  const dated = (count: number, size = 10) => ({
    ...emptyLedger(),
    stored: Array.from({ length: count }, (_, n) => ({
      key: `${KEY}${n}`,
      at: NOW - (count - n) * 1000,
      answers: ['x'.repeat(size)],
    })),
  });

  it(`keeps the newest ${MAX_STORED_ANSWERS}`, () => {
    const pruned = pruneLedger(dated(MAX_STORED_ANSWERS + 3), NOW);

    expect(pruned.stored).toHaveLength(MAX_STORED_ANSWERS);
    expect(pruned.stored[0]!.key).toBe(`${KEY}3`);
    expect(pruned.stored.at(-1)!.key).toBe(`${KEY}${MAX_STORED_ANSWERS + 2}`);
  });

  it(`keeps the newest that fit in ${STORED_ANSWERS_MAX_BYTES} bytes, and moves no floor`, () => {
    const size = Math.floor(STORED_ANSWERS_MAX_BYTES / 3);
    const pruned = pruneLedger(dated(4, size), NOW);

    expect(pruned.stored.map(({ key }) => key)).toEqual([`${KEY}2`, `${KEY}3`]);
    expect(pruned.vouchesFrom).toBeNull();
  });

  it(`forgets one older than ${LEDGER_MAX_AGE_DAYS} days`, () => {
    const old = { ...stored(1), stored: [{ key: KEY, at: NOW - 91 * DAY_MS, answers: ['x'] }] };

    expect(pruneLedger(old, NOW).stored).toEqual([]);
  });

  it('leaves the handled records the room left over, and the section within its bytes', () => {
    let ledger = stored(2, 4000);
    for (let n = 0; n < 200; n += 1) {
      const path = createVaultPath(`Meetings/M${n}.md`);
      ledger = recordRun(
        ledger,
        {
          kind: 'run',
          at: at(0),
          trigger: 'note',
          done: [],
          left: [],
          capped: false,
          versions: [{ path, digest: `d${n}`, wrote: false }],
        },
        NOW + n,
      );
    }
    const maxBytes = 12_000;

    const pruned = pruneLedger(ledger, NOW + 500, { maxBytes });

    expect(pruned.stored).toHaveLength(2);
    expect(pruned.paths.size).toBeGreaterThan(0);
    expect(pruned.paths.size).toBeLessThan(200);
    expect(utf8Length(formatLedger(pruned))).toBeLessThanOrEqual(maxBytes);
  });
});

describe('a ledger holding answers, pruned to its bytes', () => {
  it('never writes a section past its bytes, whatever the bound, as its count gains a digit', () => {
    const NOW = Date.UTC(2026, 9, 14);
    let ledger = recordStored(
      emptyLedger(),
      Array.from({ length: 5 }, (_, n) => ({ key: `${KEY}${n}`, answers: ['an answer'] })),
      NOW,
    );
    for (let n = 0; n < 98; n += 1) {
      ledger = recordRun(
        ledger,
        {
          kind: 'run',
          at: at(0),
          trigger: 'note',
          done: [],
          left: [],
          capped: false,
          versions: [{ path: createVaultPath(`M${n}.md`), digest: `d${n}`, wrote: false }],
        },
        NOW + n,
      );
    }
    const whole = utf8Length(formatLedger(ledger));

    for (let maxBytes = whole - 300; maxBytes <= whole; maxBytes += 1) {
      const pruned = pruneLedger(ledger, NOW + 500, { maxBytes });
      expect(utf8Length(formatLedger(pruned))).toBeLessThanOrEqual(maxBytes);
    }
  });
});

describe('two ledgers merged', () => {
  it('keep the newer answer to the same words, and every other', () => {
    const other = 'meeting:granola:granola-7e2f:transcript:1a2b';
    const a = append(null, failed(0), [{ key: KEY, answers: ['older'] }]);
    const b = append(null, failed(1), [
      { key: KEY, answers: ['newer'] },
      { key: other, answers: ['other'] },
    ]);
    // The newer ledger first: which wins is decided by when each was kept, not by which is read last.
    const both = `${b}\n${a.slice(a.indexOf('## Handled so far'))}`;

    const ledger = readHandledLedger(both)!;

    expect(ledger.damaged).toBe(true);
    expect(storedAnswerFor(ledger, KEY)?.answers).toEqual(['newer']);
    expect(storedAnswerFor(ledger, other)?.answers).toEqual(['other']);
  });
});
