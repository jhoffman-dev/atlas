import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { AutomationAction } from './automation-rule.ts';
import {
  outputPeriod,
  periodNoteMade,
  samePeriod,
  writesOneNoteAPeriod,
  type OutputPeriod,
} from './output-period.ts';
import { formatLogEntry, logEntrySummary, parseRunLog, type LogEntry } from './run-log.ts';
import type { Schedule } from './schedule.ts';

/** #40: one note a period, known by the period's slot and an item, read from the log. */

const FRIDAYS: Schedule = { kind: 'weekly', day: 'friday', at: '15:00' };
const MORNINGS: Schedule = { kind: 'daily', at: '07:00' };
const NOTE_STEP: AutomationAction = {
  kind: 'claude',
  prompt: '.atlas/prompts/friday-review.md',
  tools: [],
  output: { kind: 'note', folder: 'Reviews' },
};
const WEEK: OutputPeriod = { slot: '2026-10-23T15:00:00' };
const REVIEW = createVaultPath('Reviews/Weekly review 2026-10-23.md');

const run = (fields: Partial<Extract<LogEntry, { kind: 'run' }>> = {}): LogEntry => ({
  kind: 'run',
  at: '2026-10-23T15:00:04',
  trigger: 'schedule',
  done: [],
  left: [],
  capped: false,
  ...fields,
});

describe('writesOneNoteAPeriod', () => {
  it('is a Claude step writing a note on a daily or weekly clock', () => {
    expect(writesOneNoteAPeriod({ when: FRIDAYS, action: NOTE_STEP })).toBe(true);
    expect(writesOneNoteAPeriod({ when: MORNINGS, action: NOTE_STEP })).toBe(true);
  });

  it('is no other rule: proposals, a move, or a schedule with no periods', () => {
    const proposals: AutomationAction = {
      ...NOTE_STEP,
      output: { kind: 'proposals', schema: 'proposals' },
    } as AutomationAction;
    expect(writesOneNoteAPeriod({ when: FRIDAYS, action: proposals })).toBe(false);
    expect(writesOneNoteAPeriod({ when: FRIDAYS, action: { kind: 'archive' } })).toBe(false);
    for (const when of [
      { kind: 'hourly', every: 6 },
      { kind: 'manual' },
      { kind: 'open' },
      { kind: 'note', type: 'meeting', on: ['created'] },
    ] as const) {
      expect(writesOneNoteAPeriod({ when, action: NOTE_STEP })).toBe(false);
    }
  });
});

describe('outputPeriod', () => {
  it('is the Friday the run falls after, on time, caught up, or by hand', () => {
    for (const at of ['2026-10-23T15:00:00', '2026-10-24T08:00:00', '2026-10-28T11:00:00']) {
      expect(outputPeriod({ schedule: FRIDAYS, at })).toEqual(WEEK);
    }
    // By hand on the Friday morning: still the week of the Friday before.
    expect(outputPeriod({ schedule: FRIDAYS, at: '2026-10-23T09:00:00' })).toEqual({
      slot: '2026-10-16T15:00:00',
    });
  });

  it('carries the item a rule writes one note for within the period (#39)', () => {
    const item = 'Meetings/2026-10-23 Standup.md';
    expect(outputPeriod({ schedule: MORNINGS, at: '2026-10-23T07:05:00', item })).toEqual({
      slot: '2026-10-23T07:00:00',
      item,
    });
  });

  it('has none for a schedule with no periods', () => {
    expect(outputPeriod({ schedule: { kind: 'manual' }, at: '2026-10-23T15:00:00' })).toBeNull();
    expect(
      outputPeriod({ schedule: { kind: 'hourly', every: 1 }, at: '2026-10-23T15:00:00' }),
    ).toBeNull();
  });
});

describe('samePeriod', () => {
  it('is the same slot and the same item, or both without one', () => {
    expect(samePeriod(WEEK, { slot: WEEK.slot })).toBe(true);
    expect(samePeriod(WEEK, { slot: '2026-10-30T15:00:00' })).toBe(false);
    expect(samePeriod({ ...WEEK, item: 'a' }, { ...WEEK, item: 'a' })).toBe(true);
    expect(samePeriod({ ...WEEK, item: 'a' }, { ...WEEK, item: 'b' })).toBe(false);
    expect(samePeriod({ ...WEEK, item: 'a' }, WEEK)).toBe(false);
  });
});

describe('periodNoteMade', () => {
  const made = run({ done: [{ kind: 'created', path: REVIEW }], period: WEEK });

  it('is the note a run made for the period', () => {
    expect(periodNoteMade([made], WEEK)).toBe(REVIEW);
    expect(periodNoteMade([made, run({ at: '2026-10-24T08:00:00' })], WEEK)).toBe(REVIEW);
  });

  it('is none for another period, another item, or a run that made no note', () => {
    expect(periodNoteMade([made], { slot: '2026-10-30T15:00:00' })).toBeNull();
    expect(periodNoteMade([made], { ...WEEK, item: 'Meetings/a.md' })).toBeNull();
    expect(periodNoteMade([run({ period: WEEK })], WEEK)).toBeNull();
    // A note made by a run that did not say its period is not this period's.
    expect(periodNoteMade([run({ done: [{ kind: 'created', path: REVIEW }] })], WEEK)).toBeNull();
    expect(periodNoteMade([], WEEK)).toBeNull();
  });

  it('tells one item from another within a period', () => {
    const standup = { slot: '2026-10-23T07:00:00', item: 'Meetings/Standup.md' };
    const review = { slot: '2026-10-23T07:00:00', item: 'Meetings/Review.md' };
    const brief = createVaultPath('Briefs/Standup brief.md');
    const log = [run({ done: [{ kind: 'created', path: brief }], period: standup })];
    expect(periodNoteMade(log, standup)).toBe(brief);
    expect(periodNoteMade(log, review)).toBeNull();
  });
});

describe('the period in the run log', () => {
  it('is written and read back, with and without an item', () => {
    for (const period of [WEEK, { slot: WEEK.slot, item: 'Meetings/a "b".md' }]) {
      const entry = run({ done: [{ kind: 'created', path: REVIEW }], period });
      const text = formatLogEntry(entry);
      expect(text).toContain(`- period \`${JSON.stringify(period.slot)}\``);
      expect(parseRunLog(text)).toEqual([entry]);
    }
  });

  it('says a run that found its note made made nothing new', () => {
    const found = run({ period: WEEK });
    expect(logEntrySummary(found)).toBe(
      'Its note for 2026-10-23 15:00:00 is made already: nothing new.',
    );
    expect(parseRunLog(formatLogEntry(found))).toEqual([found]);
    expect(logEntrySummary(run({ done: [{ kind: 'created', path: REVIEW }], period: WEEK }))).toBe(
      'Made 1 note.',
    );
  });

  it('leaves out a period line edited into something that does not read', () => {
    const text = formatLogEntry(run({ period: WEEK })).replace(
      '"2026-10-23T15:00:00"',
      '"2026-10-23',
    );
    expect(parseRunLog(text)[0]).not.toHaveProperty('period');
    const numbered = formatLogEntry(run({ period: WEEK })).replace('"2026-10-23T15:00:00"', '42');
    expect(parseRunLog(numbered)[0]).not.toHaveProperty('period');
    const badItem = formatLogEntry(run({ period: { ...WEEK, item: 'x' } })).replace('"x"', '7');
    expect(parseRunLog(badItem)[0]).not.toHaveProperty('period');
  });
});
