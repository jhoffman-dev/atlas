/**
 * Attack tests for PR #539 (#40, the Friday weekly-review draft): the weekly
 * schedule, one note a period, and the citation check, pushed at their edges.
 * Every clock here is a fixed wall-clock string; the one property test runs
 * over a seeded generator.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { dueTrigger } from './automation-due.ts';
import type { AutomationRule } from './automation-rule.ts';
import { keepCitedItems, nothingCitedProblem } from './cited-items.ts';
import { outputPeriod, periodNoteMade } from './output-period.ts';
import { formatLogEntry, parseRunLog, type LogEntry } from './run-log.ts';
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

describe('parseSchedule: weekly, as people write it (attack #539)', () => {
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

describe('weekly times on the wall clock (attack #539)', () => {
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

describe('one note a period, read from the log (attack #539)', () => {
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
    expect(periodNoteMade(entries, { slot: '2026-10-23T15:00:00' })).toBeNull();
  });

  it('keeps one note a week when the rule’s time moves later on the same Friday', () => {
    // Made at 15:00; the person moves the rule to 16:00 that afternoon.
    const entries = [
      made('2026-10-23T15:00:00', '2026-10-23T15:00:00', 'Reviews/Weekly review 2026-10-23.md'),
    ];
    const moved: Schedule = { kind: 'weekly', day: 'friday', at: '16:00' };
    const period = outputPeriod({ schedule: moved, at: '2026-10-23T16:00:00' })!;
    expect(periodNoteMade(entries, period)).not.toBeNull();
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
          periodNoteMade(entries, period) === null
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

describe('the citation check (attack #539)', () => {
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
