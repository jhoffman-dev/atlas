/**
 * Regression tests from the review of PR #539 (#40, the Friday weekly-review draft): the weekly
 * schedule, one note a period, and the citation check, pushed at their edges.
 * Every clock here is a fixed wall-clock string; the one property test runs
 * over a seeded generator.
 */
import { describe, expect, it } from 'vitest';
import { wikiLinkSpans } from '../markdown/wikilink-spans.ts';
import { reviewDraftData, type ReviewDraftInput } from '../review/review-draft.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { dueTrigger } from './automation-due.ts';
import type { AutomationRule } from './automation-rule.ts';
import { describePlan } from './automation-plan.ts';
import { keepCitedItems, nothingCitedProblem } from './cited-items.ts';
import {
  currentPeriod,
  notePeriod,
  outputPeriod,
  periodNoteMade,
  periodNoteOf,
  periodProperties,
  periodRecorded,
  type PeriodNote,
} from './output-period.ts';
import {
  appendLogEntry,
  formatLogEntry,
  lastScheduleMark,
  parseRunLog,
  type LogEntry,
} from './run-log.ts';
import {
  isDue,
  nextRunAfter,
  parseSchedule,
  printSchedule,
  slotAtOrBefore,
  WEEKDAYS,
  type Schedule,
} from './schedule.ts';

const FRIDAYS: Schedule = { kind: 'weekly', day: 'friday', at: '15:00' };

describe('parseSchedule: weekly, as people write it', () => {
  it.each([
    ['fridays at 15:00'],
    ['Friday at 15:00'],
    ['  FRIDAYS   AT 15:00 '],
    ['every friday at 15:00'],
    ['weekly on fri at 15:00'],
  ])('reads %j as Fridays at 15:00', (text) => {
    expect(parseSchedule(text)).toEqual(FRIDAYS);
  });

  it.each([
    ['friday at 3pm'],
    ['FRI 15:00'],
    ['every friday at 24:00'],
    ['fridays at 15:60'],
    ['fridays at 15:00 please'],
    ['fridya at 15:00'],
    ['mondays and fridays at 15:00'],
    ['monday, friday at 15:00'],
    ['ｆｒｉｄａｙ at 15:00'],
    ['vendredi at 15:00'],
    ['fridays at -1:00'],
    ['fridays at 1:5'],
    ['fridays at'],
    ['s at 15:00'],
  ])('refuses %j rather than guessing a day or a time', (text) => {
    expect(parseSchedule(text)).toBeNull();
  });

  it('reads "thurs" as it reads "tues" and "weds": the common short forms of a day', () => {
    // "tues" and "weds" read only because a trailing "s" is taken for a plural.
    expect(parseSchedule('tues at 09:00')).toEqual({ kind: 'weekly', day: 'tuesday', at: '09:00' });
    expect(parseSchedule('weds at 09:00')).toEqual({
      kind: 'weekly',
      day: 'wednesday',
      at: '09:00',
    });
    expect(parseSchedule('thurs at 09:00')).toEqual({
      kind: 'weekly',
      day: 'thursday',
      at: '09:00',
    });
  });

  it('prints every weekly schedule so it reads back as itself', () => {
    for (const day of WEEKDAYS) {
      for (const at of ['00:00', '07:05', '15:00', '23:59']) {
        const schedule: Schedule = { kind: 'weekly', day, at };
        expect(parseSchedule(printSchedule(schedule))).toEqual(schedule);
      }
    }
  });

  it.each<[string, Schedule]>([
    ['daily at 03:00', { kind: 'daily', at: '03:00' }],
    ['daily at 7:30', { kind: 'daily', at: '07:30' }],
    ['every 6 hours', { kind: 'hourly', every: 6 }],
    ['every 1 hour', { kind: 'hourly', every: 1 }],
    ['on app open', { kind: 'open' }],
    ['manually', { kind: 'manual' }],
  ])('still reads the older kind %j as before', (text, schedule) => {
    expect(parseSchedule(text)).toEqual(schedule);
    expect(parseSchedule(printSchedule(schedule))).toEqual(schedule);
  });

  it('still reads a note trigger, and no weekly reading takes it', () => {
    expect(parseSchedule('a meeting is created or changed')).toMatchObject({ kind: 'note' });
  });
});

describe('weekly times on the wall clock', () => {
  it('falls due on the Friday after, from a run at exactly 15:00', () => {
    expect(nextRunAfter(FRIDAYS, '2026-10-23T15:00:00')).toBe('2026-10-30T15:00:00');
    expect(nextRunAfter(FRIDAYS, '2026-10-23T14:59:59')).toBe('2026-10-23T15:00:00');
  });

  it('crosses a year and a leap day by the calendar', () => {
    expect(nextRunAfter(FRIDAYS, '2027-12-31T15:00:00')).toBe('2028-01-07T15:00:00');
    const thursdays: Schedule = { kind: 'weekly', day: 'thursday', at: '09:00' };
    expect(nextRunAfter(thursdays, '2028-02-24T09:00:00')).toBe('2028-03-02T09:00:00');
    expect(slotAtOrBefore({ kind: 'daily', at: '10:00' }, '2028-02-29T10:00:00')).toBe(
      '2028-02-29T10:00:00',
    );
  });

  it('is due the first moment after a 02:30 the US spring-forward skips', () => {
    const sundays: Schedule = { kind: 'weekly', day: 'sunday', at: '02:30' };
    // 2026-03-08: US clocks go from 01:59:59 to 03:00:00.
    expect(
      isDue({ schedule: sundays, since: '2026-03-01T02:30:00', now: '2026-03-08T01:59:59' }),
    ).toBe(false);
    expect(
      isDue({ schedule: sundays, since: '2026-03-01T02:30:00', now: '2026-03-08T03:00:00' }),
    ).toBe(true);
    expect(slotAtOrBefore(sundays, '2026-03-08T03:00:00')).toBe('2026-03-08T02:30:00');
  });

  it('does not run twice when the EU fall-back shows 02:30 twice', () => {
    const sundays: Schedule = { kind: 'weekly', day: 'sunday', at: '02:30' };
    const rule: AutomationRule = {
      id: 'Sunday sweep',
      path: createVaultPath('.atlas/automations/Sunday sweep.md'),
      name: 'Sunday sweep',
      enabled: true,
      when: sundays,
      which: 'FROM task',
      olderThanDays: null,
      action: { kind: 'archive' },
    } as AutomationRule;
    // 2026-10-25: EU clocks show 02:00-02:59 twice. The first pass ran at 02:30:40;
    // the second pass reaches 02:30:10, which reads as earlier than that run.
    const log: LogEntry[] = [
      {
        kind: 'run',
        at: '2026-10-18T02:30:20',
        trigger: 'schedule',
        done: [],
        left: [],
        capped: false,
      },
      {
        kind: 'run',
        at: '2026-10-25T02:30:40',
        trigger: 'schedule',
        done: [],
        left: [],
        capped: false,
      },
    ];
    expect(
      dueTrigger({
        rule,
        log,
        now: '2026-10-25T02:30:10',
        watchingSince: '2026-01-01T00:00:00',
        opening: false,
      }),
    ).toBeNull();
  });
});

const made = (at: string, slot: string, path: string): Extract<LogEntry, { kind: 'run' }> => ({
  kind: 'run',
  at,
  trigger: 'schedule',
  done: [{ kind: 'created', path: createVaultPath(path) }],
  left: [],
  capped: false,
  period: { slot },
});

describe('one note a period, read from the log', () => {
  it('keeps the period of a run whose item holds a backtick, a quote and a newline through the log', () => {
    const entry: Extract<LogEntry, { kind: 'run' }> = {
      ...made('2026-10-23T07:00:00', '2026-10-23T07:00:00', 'Briefs/Brief.md'),
      period: { slot: '2026-10-23T07:00:00', item: 'Meetings/`Odd` "one"\nhere.md' },
    };
    const [read] = parseRunLog(`# Log\n\n${formatLogEntry(entry)}`);
    expect(read).toMatchObject({ period: entry.period });
  });

  it('does not count a period as made when the run that made it was undone', () => {
    const entries: LogEntry[] = [
      made('2026-10-23T15:00:00', '2026-10-23T15:00:00', 'Reviews/Weekly review 2026-10-23.md'),
      {
        kind: 'undo',
        at: '2026-10-23T15:05:00',
        of: '2026-10-23T15:00:00',
        done: [{ kind: 'created', path: createVaultPath('Reviews/Weekly review 2026-10-23.md') }],
        left: [],
      } as LogEntry,
    ];
    expect(
      periodNoteMade({
        entries,
        period: { slot: '2026-10-23T15:00:00' },
        schedule: FRIDAYS,
        now: '2026-10-23T15:10:00',
      }),
    ).toBeNull();
  });

  it('keeps one note a week when the rule’s time moves later on the same Friday', () => {
    // Made at 15:00; the person moves the rule to 16:00 that afternoon.
    const entries = [
      made('2026-10-23T15:00:00', '2026-10-23T15:00:00', 'Reviews/Weekly review 2026-10-23.md'),
    ];
    const moved: Schedule = { kind: 'weekly', day: 'friday', at: '16:00' };
    const now = '2026-10-23T16:00:00';
    const period = outputPeriod({ schedule: moved, at: now })!;
    expect(periodNoteMade({ entries, period, schedule: moved, now })).not.toBeNull();
  });

  it('holds at most one note a period over random clocks and hand runs (seeded)', () => {
    let seed = 0x539;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 40; round += 1) {
      const schedule: Schedule =
        rand() < 0.5
          ? { kind: 'daily', at: `${String(Math.floor(rand() * 24)).padStart(2, '0')}:30` }
          : { kind: 'weekly', day: WEEKDAYS[Math.floor(rand() * 7)]!, at: '15:00' };
      let now = Date.UTC(2026, 9, 1, 0, 0, 0);
      const entries: LogEntry[] = [];
      for (let tick = 0; tick < 300; tick += 1) {
        // Mostly forward by up to a day; now and then the clock goes back hours.
        now += rand() < 0.1 ? -Math.floor(rand() * 5) * 3_600_000 : Math.floor(rand() * 86_400_000);
        const at = new Date(now).toISOString().slice(0, 19);
        const period = outputPeriod({ schedule, at })!;
        const entry: LogEntry =
          periodNoteMade({ entries, period, schedule, now: at }) === null
            ? made(at, period.slot, `Notes/${at}.md`)
            : { kind: 'run', at, trigger: 'hand', done: [], left: [], capped: false, period };
        entries.push(entry);
        // The log keeps its newest 100 entries, as appendEntryToLog does.
        if (entries.length > 100) entries.shift();
      }
      const slots = entries.flatMap((entry) =>
        entry.kind === 'run' && entry.done.length > 0 && entry.period ? [entry.period.slot] : [],
      );
      expect(new Set(slots).size).toBe(slots.length);
    }
  });
});

const SOURCES = new Set([
  'Tasks/Send the file.md',
  'Projects/Larkspur launch.md',
  'Meetings/2026-10-21 Standup.md',
]);
const cite = (body: string) => keepCitedItems({ body, sources: SOURCES });

describe('the citation check', () => {
  it.each([
    ['- Sent it: [[Tasks/Send the file.md]]'],
    ['- Sent it: [[Tasks/Send the file]]'],
    ['- Sent it: [[Tasks/Send the file.md#Notes]]'],
    ['- Sent it: [[Tasks/Send the file.md|the file]]'],
    ['1. Sent it: [[Tasks/Send the file.md]]'],
    ['* [ ] Chase [[Projects/Larkspur launch.md]]'],
    ['  - nested: [[Meetings/2026-10-21 Standup.md]]'],
  ])('keeps %j, which links a note it was given', (line) => {
    expect(cite(`${line}\n`)).toMatchObject({ kept: 1, dropped: [] });
  });

  it.each([
    ['- Sent it: `[[Tasks/Send the file.md]]`'],
    ['- Sent it <!-- [[Tasks/Send the file.md]] -->'],
    ['- Sent it: [[Send the file]]'],
    ['- Sent it: [[Tasks/Elsewhere.md]]'],
    ['- Sent it: \\[[Tasks/Send the file.md]]'],
  ])('drops %j, which cites nothing it was given', (line) => {
    expect(cite(`${line}\n- Kept: [[Tasks/Send the file.md]]\n`)).toMatchObject({ kept: 1 });
    expect(cite(`${line}\n`).dropped).toHaveLength(1);
  });

  it('refuses a draft that holds no list item at all: nothing in it is cited', () => {
    const cited = cite('## Wins\n\nThe whole quarter closed and every deal was signed.\n');
    expect(nothingCitedProblem(cited)).not.toBeNull();
  });

  it('leaves no uncited claim behind when it drops an item that runs on to a second line', () => {
    const cited = cite(
      '- Kept: [[Tasks/Send the file.md]]\n- Closed the quarter,\n  and every deal was signed.\n',
    );
    expect(cited.body).not.toContain('every deal was signed');
  });

  it('holds a list item inside a block quote to the same rule', () => {
    const cited = cite('- Kept: [[Tasks/Send the file.md]]\n> - Signed the Larkspur deal\n');
    expect(cited.body).not.toContain('Signed the Larkspur deal');
  });

  it('keeps the data block handed back verbatim: every line cites its own note', () => {
    const body = [
      '- [[Tasks/Send the file.md]] Send the file',
      '- [[Projects/Larkspur launch.md]] Larkspur launch',
    ].join('\n');
    expect(cite(body)).toMatchObject({ kept: 2, dropped: [] });
  });
});

const DAILY: Schedule = { kind: 'daily', at: '07:00' };

describe('which period a run is for (review of #539, D4 D6 D14)', () => {
  it('keeps a week by its ISO week, Monday first, whichever Friday time the slot has', () => {
    const entries = [
      made('2026-10-23T15:00:00', '2026-10-23T15:00:00', 'Reviews/Weekly review 2026-10-23.md'),
    ];
    const sameWeek = { slot: '2026-10-23T16:00:00' };
    const nextWeek = { slot: '2026-10-30T15:00:00' };
    const at = (now: string) => ({ entries, schedule: FRIDAYS, now });
    expect(periodNoteMade({ ...at('2026-10-24T09:00:00'), period: sameWeek })).not.toBeNull();
    expect(periodNoteMade({ ...at('2026-10-30T15:00:00'), period: nextWeek })).toBeNull();
  });

  it('names a run by hand’s period the calendar week it is in, Monday to Sunday', () => {
    // Wednesday: this week’s Friday slot has not come, and is still the week’s period.
    expect(currentPeriod({ schedule: FRIDAYS, at: '2026-10-21T10:00:00' })).toEqual({
      slot: '2026-10-23T15:00:00',
    });
    // Sunday belongs to the week that began on the Monday before it.
    expect(currentPeriod({ schedule: FRIDAYS, at: '2026-10-25T23:59:59' })).toEqual({
      slot: '2026-10-23T15:00:00',
    });
    expect(currentPeriod({ schedule: FRIDAYS, at: '2026-10-26T00:00:00' })).toEqual({
      slot: '2026-10-30T15:00:00',
    });
    // A rule whose slot falls on a Sunday keeps it in the week the Monday began.
    const sundays: Schedule = { kind: 'weekly', day: 'sunday', at: '02:30' };
    expect(currentPeriod({ schedule: sundays, at: '2026-10-21T10:00:00' })).toEqual({
      slot: '2026-10-25T02:30:00',
    });
  });

  it('names a daily rule’s period today, before or after its time', () => {
    expect(currentPeriod({ schedule: DAILY, at: '2026-10-23T06:00:00' })).toEqual({
      slot: '2026-10-23T07:00:00',
    });
    expect(
      currentPeriod({ schedule: DAILY, at: '2026-10-23T23:00:00', item: 'Meetings/A.md' }),
    ).toEqual({ slot: '2026-10-23T07:00:00', item: 'Meetings/A.md' });
  });

  it('does not let a week or a day ahead of the clock use up its period', () => {
    const entries = [
      made('2026-11-20T15:00:00', '2026-11-20T15:00:00', 'Reviews/Weekly review 2026-11-20.md'),
    ];
    const ahead = { slot: '2026-11-20T15:00:00' };
    expect(
      periodNoteMade({ entries, period: ahead, schedule: FRIDAYS, now: '2026-10-30T15:00:00' }),
    ).toBeNull();
    expect(
      periodRecorded({ entries, period: ahead, schedule: FRIDAYS, now: '2026-10-30T15:00:00' }),
    ).toBe(false);
    expect(
      periodNoteMade({ entries, period: ahead, schedule: FRIDAYS, now: '2026-11-20T15:00:00' }),
    ).not.toBeNull();
    const tomorrow = [made('2026-10-24T07:00:00', '2026-10-24T07:00:00', 'Briefs/Brief.md')];
    expect(
      periodNoteMade({
        entries: tomorrow,
        period: { slot: '2026-10-24T07:00:00' },
        schedule: DAILY,
        now: '2026-10-23T08:00:00',
      }),
    ).toBeNull();
  });

  it('counts a note that carries the period though the log never recorded it', () => {
    const notes = [
      {
        path: createVaultPath('Reviews/Weekly review.md'),
        period: { slot: '2026-10-23T15:00:00' },
        rule: 'Friday review',
      },
    ];
    const args = {
      entries: [],
      notes,
      rule: 'Friday review',
      schedule: FRIDAYS,
      now: '2026-10-23T15:30:00',
    };
    expect(periodNoteMade({ ...args, period: { slot: '2026-10-23T15:00:00' } })).toBe(
      'Reviews/Weekly review.md',
    );
    expect(periodNoteMade({ ...args, period: { slot: '2026-10-30T15:00:00' } })).toBeNull();
    const future = [{ ...notes[0]!, period: { slot: '2026-11-20T15:00:00' } }];
    expect(
      periodNoteMade({ ...args, notes: future, period: { slot: '2026-11-20T15:00:00' } }),
    ).toBeNull();
  });

  it('tells a note made once for an item from the same period’s other items', () => {
    const notes = [
      {
        path: createVaultPath('Briefs/A.md'),
        period: { slot: '2026-10-23T07:00:00', item: 'M/A.md' },
        rule: 'Morning brief',
      },
    ];
    const args = {
      entries: [],
      notes,
      rule: 'Morning brief',
      schedule: DAILY,
      now: '2026-10-23T08:00:00',
    };
    expect(
      periodNoteMade({ ...args, period: { slot: '2026-10-23T07:00:00', item: 'M/A.md' } }),
    ).not.toBeNull();
    expect(
      periodNoteMade({ ...args, period: { slot: '2026-10-23T07:00:00', item: 'M/B.md' } }),
    ).toBeNull();
  });

  it('says a period is recorded though its run was undone and its note deleted', () => {
    const entries: LogEntry[] = [
      made('2026-10-23T15:00:00', '2026-10-23T15:00:00', 'Reviews/Weekly review 2026-10-23.md'),
      {
        kind: 'undo',
        at: '2026-10-23T15:05:00',
        of: '2026-10-23T15:00:00',
        done: [],
        left: [],
      } as LogEntry,
    ];
    const args = { entries, period: { slot: '2026-10-23T15:00:00' }, schedule: FRIDAYS };
    expect(periodRecorded({ ...args, now: '2026-10-24T09:00:00' })).toBe(true);
    expect(periodNoteMade({ ...args, now: '2026-10-24T09:00:00' })).toBeNull();
  });

  it('does not count a note the disk no longer has as made, when asked', () => {
    const entries = [
      made('2026-10-23T15:00:00', '2026-10-23T15:00:00', 'Reviews/Weekly review 2026-10-23.md'),
    ];
    const args = { entries, period: { slot: '2026-10-23T15:00:00' }, schedule: FRIDAYS };
    const now = '2026-10-24T09:00:00';
    expect(periodNoteMade({ ...args, now, exists: () => false })).toBeNull();
    expect(periodNoteMade({ ...args, now, exists: () => true })).not.toBeNull();
  });

  it('writes the period into a note’s properties, which read back as it', () => {
    const period = { slot: '2026-10-23T15:00:00', item: 'Meetings/Standup.md' };
    expect(periodProperties({ slot: period.slot })).toEqual({ atlas_period: period.slot });
    expect(notePeriod(periodProperties(period))).toEqual(period);
    expect(notePeriod({ atlas_period: 'next Friday' })).toBeNull();
    expect(notePeriod({})).toBeNull();
  });
});

describe('the log holds on to the note a period made (review of #539, D7)', () => {
  it('keeps the entry that made a period’s note through a hundred and one runs after it', () => {
    let text: string | null = null;
    const first = made('2026-10-23T07:00:00', '2026-10-23T07:00:00', 'Briefs/Brief.md');
    text = appendLogEntry({ text, ruleName: 'Morning brief', entry: first, now: 0 });
    for (let minute = 0; minute < 101; minute += 1) {
      const at = `2026-10-23T${String(8 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
      const found: LogEntry = {
        kind: 'run',
        at,
        trigger: 'hand',
        done: [],
        left: [],
        capped: false,
        period: { slot: '2026-10-23T07:00:00' },
      };
      text = appendLogEntry({ text, ruleName: 'Morning brief', entry: found, now: minute });
    }
    const entries = parseRunLog(text!);
    expect(
      periodNoteMade({
        entries,
        period: { slot: '2026-10-23T07:00:00' },
        schedule: DAILY,
        now: '2026-10-23T11:00:00',
      }),
    ).toBe('Briefs/Brief.md');
  });
});

describe('a repeated hour, when the clocks go back (review of #539, D13)', () => {
  const nightly: AutomationRule = {
    id: 'Nightly',
    path: createVaultPath('.atlas/automations/Nightly.md'),
    name: 'Nightly',
    enabled: true,
    when: { kind: 'daily', at: '02:30' },
    which: 'FROM task',
    olderThanDays: null,
    action: { kind: 'archive' },
  } as AutomationRule;
  const ranAt = (at: string): LogEntry => ({
    kind: 'run',
    at,
    trigger: 'schedule',
    done: [],
    left: [],
    capped: false,
  });
  const due = (log: LogEntry[], now: string) =>
    dueTrigger({ rule: nightly, log, now, watchingSince: '2026-01-01T00:00:00', opening: false });

  it('does not run a daily rule again when the second 02:30 reads before the first run', () => {
    const log = [ranAt('2026-10-25T02:30:40')];
    expect(due(log, '2026-10-25T02:30:10')).toBeNull();
    expect(due(log, '2026-10-25T02:59:59')).toBeNull();
  });

  it('still ignores a mark hours ahead of the clock, which would hold the rule back for good', () => {
    const log = [ranAt('2026-10-25T08:00:00')];
    expect(lastScheduleMark(log, '2026-10-25T02:30:10')).toBeNull();
    expect(due(log, '2026-10-25T02:30:10')).toBe('schedule');
  });
});

describe('the citation check, deeper (review of #539, D8)', () => {
  it('takes an item’s indented children and continuation lines with it when it drops the item', () => {
    const cited = cite(
      [
        '- Kept: [[Tasks/Send the file.md]]',
        '- Closed the quarter',
        '  - and signed every deal',
        '  more about the quarter',
        '',
        '    still the quarter',
        '- Kept too: [[Projects/Larkspur launch.md]]',
        '',
      ].join('\n'),
    );
    expect(cited.body).toBe(
      [
        '- Kept: [[Tasks/Send the file.md]]',
        '- Kept too: [[Projects/Larkspur launch.md]]',
        '',
      ].join('\n'),
    );
    expect(cited.dropped).toHaveLength(1);
  });

  it('keeps the children of a kept item, each held to the rule on its own', () => {
    const cited = cite(
      [
        '- Kept: [[Tasks/Send the file.md]]',
        '  - child that cites [[Projects/Larkspur launch.md]]',
        '  - child that cites nothing',
        '',
      ].join('\n'),
    );
    expect(cited.body).toBe(
      [
        '- Kept: [[Tasks/Send the file.md]]',
        '  - child that cites [[Projects/Larkspur launch.md]]',
        '',
      ].join('\n'),
    );
  });

  it('holds a block quote’s list item, nested quotes too, to the rule', () => {
    const cited = cite(
      '> - Signed the deal\n> > - Also signed\n> - Fine: [[Tasks/Send the file.md]]\n',
    );
    expect(cited.body).toBe('> - Fine: [[Tasks/Send the file.md]]\n');
    expect(cited.dropped).toHaveLength(2);
    expect(cited.kept).toBe(1);
  });

  it('turns a link to a note it was not given into plain text, keeps the item, and says so', () => {
    const cited = cite(
      '- Sent it: [[Tasks/Send the file.md]], and signed [[Clients/Acme.md|the Acme deal]]\n',
    );
    expect(cited.body).toBe('- Sent it: [[Tasks/Send the file.md]], and signed the Acme deal\n');
    expect(cited).toMatchObject({ kept: 1, dropped: [] });
    expect(cited.stripped).toEqual([
      {
        title: 'Sent it: [[Tasks/Send the file.md]], and signed the Acme deal',
        reason: expect.stringContaining('Clients/Acme'),
      },
    ]);
  });

  it('writes a stripped link by its title when it has no alias', () => {
    const cited = cite('- Sent it: [[Tasks/Send the file.md]] and [[Elsewhere/Plan.md#Goals]]\n');
    expect(cited.body).toBe('- Sent it: [[Tasks/Send the file.md]] and Plan\n');
  });

  it('leaves a link in code, which is text, alone', () => {
    const body = '- Sent it: [[Tasks/Send the file.md]] and `[[Elsewhere/Plan.md]]`\n';
    expect(cite(body)).toMatchObject({ body, kept: 1, stripped: [] });
  });
});

describe('what a dry run says of a step that writes a note from data (review of #539, D1)', () => {
  const claude = {
    kind: 'claude',
    prompt: createVaultPath('.atlas/prompts/friday-review.md'),
    tools: [],
    output: { kind: 'note', folder: 'Reviews' },
    data: 'weekly-review',
  } as const;
  const plan = { action: claude, paths: [], passedOver: [], capped: false };

  it('says it would write its note, not that there is nothing to do', () => {
    expect(describePlan(plan)).toBe('Would write its note.');
  });

  it('says the period’s note is made already when it is', () => {
    const made = { ...plan, periodNote: { period: { slot: '2026-10-23T15:00:00' }, made: true } };
    expect(describePlan(made)).toBe(
      'Its note for 2026-10-23 is made already: nothing to do right now.',
    );
  });
});

const draftInput = (fields: Partial<ReviewDraftInput> = {}): ReviewDraftInput => ({
  review: { staleWaiting: [], projectsWithoutNextAction: [], overdue: [], untouchedSomeday: [] },
  done: [],
  meetings: [],
  inbox: { toFile: 3, toAnswer: 0, more: false },
  truncated: false,
  today: '2026-10-23',
  now: Date.parse('2026-10-23T15:00:00Z'),
  ...fields,
});

describe('an empty week (verification of #539)', () => {
  it('does not refuse a quiet week whose one list item has nothing to cite', () => {
    // Handed nothing to cite, a model that writes "- Nothing this week." as a bullet must still get a draft.
    const cited = keepCitedItems({
      body: '## Wins\n\n- Nothing this week.\n\n3 notes wait in the Inbox.\n',
      sources: new Set(),
    });
    expect(nothingCitedProblem(cited)).toBeNull();
  });
});

describe('the written draft never holds a source id (verification of #539, D9)', () => {
  const sources = new Set(['src:1']);
  const plain = new Map([['src:1', 'Pay A|B invoice']]);

  it('writes a source id in a sentence as its title, as it does in a list item', () => {
    const body = '- Paid it: [[src:1]]\n\nThe hardest one was [[src:1]].\n';
    const cited = keepCitedItems({ body, sources, plain });
    expect(cited.body).not.toContain('[[src:');
  });

  it('writes a source id in a heading as its title', () => {
    const body = '## [[src:1]]\n\n- Paid it: [[src:1]]\n';
    const cited = keepCitedItems({ body, sources, plain });
    expect(cited.body).not.toContain('[[src:');
  });
});

describe('a flattened name links nothing (verification of #539, D10)', () => {
  it('leaves a title of three brackets with no link of its own in the data', () => {
    const given = reviewDraftData(
      draftInput({
        done: [{ path: createVaultPath('Tasks/Odd.md'), title: '[[[Tasks/Secret plan.md]]]' }],
      }),
    );
    const line = given.data[0]!.text;
    expect(wikiLinkSpans(line).map(({ link }) => link.target)).toEqual(['Tasks/Odd.md']);
    // Its own link is the one double bracket on the line: the title's are broken.
    expect(line.split('[[')).toHaveLength(2);
  });
});

describe('periods of two rules that share a folder (verification of #539)', () => {
  it('does not take a daily rule’s note in the same folder for the weekly rule’s week', () => {
    // A note stamped by another rule that writes to Reviews/ on Wednesday is not this week's review.
    const notes = [
      {
        path: createVaultPath('Reviews/Daily notes 2026-10-21.md'),
        period: { slot: '2026-10-21T07:00:00' },
      },
    ];
    expect(
      periodRecorded({
        entries: [],
        notes,
        period: { slot: '2026-10-23T15:00:00' },
        schedule: FRIDAYS,
        now: '2026-10-23T15:00:00',
      }),
    ).toBe(false);
  });
});

describe('the period is the rule’s own (verification of #539, atlas_period_rule)', () => {
  const NOTE = createVaultPath('Reviews/Weekly review 2026-10-23.md');
  const asked = (notes: readonly PeriodNote[], entries: LogEntry[] = []) =>
    periodRecorded({
      entries,
      notes,
      rule: 'Friday review',
      period: { slot: '2026-10-23T15:00:00' },
      schedule: FRIDAYS,
      now: '2026-10-23T15:30:00',
    });
  const slot = { slot: '2026-10-23T15:00:00' };

  it('counts a note that names this rule though the log never recorded it', () => {
    expect(asked([{ path: NOTE, period: slot, rule: 'Friday review' }])).toBe(true);
  });

  it('does not count a note another rule made for the same week', () => {
    expect(asked([{ path: NOTE, period: slot, rule: 'Daily notes' }])).toBe(false);
  });

  it('counts a note that names no rule only when this rule’s log made it', () => {
    const older = [{ path: NOTE, period: slot }];
    expect(asked(older)).toBe(false);
    const madeEarlier: LogEntry = {
      kind: 'run',
      at: '2026-10-23T15:00:00',
      trigger: 'schedule',
      done: [{ kind: 'created', path: NOTE }],
      left: [],
      capped: false,
    };
    expect(asked(older, [madeEarlier])).toBe(true);
  });

  it('compares rule ids by case and Unicode form, as the ids name files', () => {
    const composed = 'Caf\u00e9 review';
    const decomposed = 'Cafe\u0301 review';
    const named = (rule: string, as: string) =>
      periodRecorded({
        entries: [],
        notes: [{ path: NOTE, period: slot, rule }],
        rule: as,
        period: slot,
        schedule: FRIDAYS,
        now: '2026-10-23T15:30:00',
      });
    expect(named('friday REVIEW', 'Friday review')).toBe(true);
    expect(named(decomposed, composed)).toBe(true);
    expect(named(composed, decomposed.toUpperCase())).toBe(true);
    expect(named('Daily notes', 'Friday review')).toBe(false);
  });

  it('writes and reads the rule beside the period', () => {
    const properties = periodProperties(slot, 'Friday review');
    expect(properties).toEqual({ atlas_period: slot.slot, atlas_period_rule: 'Friday review' });
    expect(periodNoteOf(NOTE, properties)).toEqual({
      path: NOTE,
      period: slot,
      rule: 'Friday review',
    });
    expect(periodNoteOf(NOTE, { atlas_period: slot.slot })).toEqual({ path: NOTE, period: slot });
    expect(periodNoteOf(NOTE, {})).toBeNull();
  });
});

describe('a quiet week and the draft’s frame (verification of #539, fixes)', () => {
  it('drops a quiet week’s uncited items, keeps the frame, and adds the line itself', () => {
    const cited = keepCitedItems({
      body: '## Wins\n\n- Nothing finished.\n- See [[Tasks/Elsewhere.md]]\n\n3 notes wait in the Inbox.\n',
      sources: new Set(),
    });
    expect(cited.body).toBe(
      '## Wins\n\n\n3 notes wait in the Inbox.\n\nNothing to cite this week.\n',
    );
    expect(cited.dropped.map(({ title }) => title)).toEqual([
      'Nothing finished.',
      'See [[Tasks/Elsewhere.md]]',
    ]);
    expect(nothingCitedProblem(cited)).toBeNull();
  });

  it('does not add the line to a quiet week with no list item, or when sources were given', () => {
    const frame = keepCitedItems({ body: '## Wins\n\n3 notes wait.\n', sources: new Set() });
    expect(frame.body).toBe('## Wins\n\n3 notes wait.\n');
    const given = keepCitedItems({ body: '- one\n', sources: new Set(['Tasks/A.md']) });
    expect(given.body).not.toContain('Nothing to cite this week.');
  });

  it('still refuses a draft whose items cite none of the notes it was given', () => {
    const cited = keepCitedItems({ body: '- one\n', sources: new Set(['Tasks/A.md']) });
    expect(nothingCitedProblem(cited)).not.toBeNull();
  });

  it('writes a link in a sentence or heading to a note it was not given as plain text', () => {
    const cited = keepCitedItems({
      body: '## About [[Tasks/Secret.md|the plan]]\n\n- [[Tasks/A.md]]\n\nSee [[Tasks/Secret.md]] and [[Tasks/A.md]].\n',
      sources: new Set(['Tasks/A.md']),
    });
    expect(cited.body).toBe(
      '## About the plan\n\n- [[Tasks/A.md]]\n\nSee Secret and [[Tasks/A.md]].\n',
    );
    expect(cited.stripped).toHaveLength(2);
  });

  it('leaves a source id in code as it is', () => {
    const body = '- [[src:1]]\n\nWritten `[[src:1]]` in code.\n';
    const cited = keepCitedItems({
      body,
      sources: new Set(['src:1']),
      plain: new Map([['src:1', 'T']]),
    });
    expect(cited.body).toBe('- T\n\nWritten `[[src:1]]` in code.\n');
  });
});
