import { describe, expect, it } from 'vitest';
import { useZone, ZONES } from '../calendar/zones.test-support.ts';
import {
  dropSlot,
  LONGEST_NEW_BLOCK_MINUTES,
  minutesLeftToSchedule,
  newBlockLength,
  newBlockName,
  newBlockTimes,
} from './new-block.ts';
import {
  blockMinutes,
  scheduledMinutesByTask,
  taskSchedule,
  type ScheduledTask,
  type TaskSchedule,
  type TimeBlock,
} from './scheduling.ts';

/** P31-02: the block a task dropped on empty time makes. */
const schedule = (fields: Partial<TaskSchedule>): TaskSchedule => ({
  estimate: 120,
  scheduled: 0,
  done: 0,
  overBy: 0,
  ...fields,
});

describe('how long a new block runs', () => {
  it('is what the task still needs: its estimate less what blocks already give it', () => {
    expect(newBlockLength(schedule({ estimate: 120, scheduled: 0 }))).toBe(120);
    expect(newBlockLength(schedule({ estimate: 120, scheduled: 45 }))).toBe(75);
  });

  it('counts what blocks made since the schedule was read give, so a second drop gets what is left', () => {
    expect(newBlockLength(schedule({ estimate: 120, scheduled: 45 }), 60)).toBe(15);
    expect(newBlockLength(schedule({ estimate: 120, scheduled: 45 }), 75)).toBe(30);
    expect(minutesLeftToSchedule(schedule({ estimate: 120, scheduled: 0 }), 200)).toBe(0);
  });

  it('is half an hour for a task with no estimate, or one whose schedule could not be read', () => {
    expect(newBlockLength(schedule({ estimate: null, done: null }))).toBe(30);
    expect(newBlockLength(null)).toBe(30);
  });

  it('is half an hour for a task already given all it needs, or more', () => {
    expect(newBlockLength(schedule({ estimate: 60, scheduled: 60 }))).toBe(30);
    expect(newBlockLength(schedule({ estimate: 60, scheduled: 90, overBy: 30 }))).toBe(30);
  });

  it('leaves out what is done: a finished task needs nothing more', () => {
    expect(minutesLeftToSchedule(schedule({ estimate: 60, done: 60 }))).toBe(0);
    expect(minutesLeftToSchedule(schedule({ estimate: 60, scheduled: 20, done: 0 }))).toBe(40);
  });

  it('is a day at most, so a task estimated at a week is planned a block at a time', () => {
    expect(newBlockLength(schedule({ estimate: 7 * 24 * 60 }))).toBe(LONGEST_NEW_BLOCK_MINUTES);
    expect(LONGEST_NEW_BLOCK_MINUTES).toBe(24 * 60);
    expect(newBlockLength(schedule({ estimate: 24 * 60 - 1 }))).toBe(24 * 60 - 1);
  });
});

describe('splitting a task across blocks', () => {
  const report: ScheduledTask = { path: 'Quarterly report.md', estimate: 120, finished: false };
  const block = (path: string, start: string, end: string): TimeBlock => ({
    path,
    start,
    end,
    tasks: [report],
  });
  const scheduleWith = (blocks: readonly TimeBlock[]) =>
    taskSchedule({
      task: report,
      scheduled: scheduledMinutesByTask(blocks).get(report.path) ?? 0,
    });

  it('sizes the next block to what the blocks before it leave, and the two add up to the estimate', () => {
    const first = block('First.md', '2026-10-12T09:00', '2026-10-12T10:00');

    const length = newBlockLength(scheduleWith([first]));
    const times = newBlockTimes({ start: '2026-10-13T14:00', minutes: length });

    expect(length).toBe(60);
    expect(times).toEqual({ start: '2026-10-13T14:00', end: '2026-10-13T15:00' });
    const second = block('Second.md', times!.start, times!.end);
    expect(scheduleWith([first, second])).toEqual({
      estimate: 120,
      scheduled: 120,
      done: 0,
      overBy: 0,
    });
  });

  it('a first drop takes the whole estimate, and a second reads as over-scheduled', () => {
    const times = newBlockTimes({ start: '2026-10-12T09:00', minutes: newBlockLength(null) });
    const first = block('First.md', '2026-10-12T09:00', '2026-10-12T11:00');

    expect(times?.end).toBe('2026-10-12T09:30');
    const again = newBlockLength(scheduleWith([first]));
    expect(again).toBe(30);
    const second = block('Second.md', '2026-10-12T13:00', '2026-10-12T13:30');
    expect(scheduleWith([first, second]).overBy).toBe(30);
  });
});

describe('what a new block is called', () => {
  it('is for its task, with "block" after the name so it is not the task’s name numbered', () => {
    expect(newBlockName('Quarterly report')).toBe('Quarterly report block');
    expect(newBlockName('  Call Mara ')).toBe('Call Mara block');
  });

  it('fits on the disk, numbered, for a task whose name fills nearly all of a file name', () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const title = `Quarterly report ${'é'.repeat(115)}`;

    const name = newBlockName(title);

    expect(bytes(`${title}.md`)).toBeLessThanOrEqual(255);
    expect(name.endsWith(' block')).toBe(true);
    expect(bytes(`${name} 9999.md`)).toBeLessThanOrEqual(255);
    expect(name.startsWith('Quarterly report éé')).toBe(true);
    // Cut by whole characters: never half of one.
    expect(name).not.toContain('\uFFFD');
  });

  it('is Block for a task with no name', () => {
    expect(newBlockName('  ')).toBe('Block');
  });
});

describe('where a drop lands', () => {
  it('starts on the quarter hour the drop is inside, not the nearest', () => {
    expect(dropSlot(9 * 60)).toBe(540);
    expect(dropSlot(9 * 60 + 14.9)).toBe(540);
    expect(dropSlot(9 * 60 + 15)).toBe(555);
    expect(dropSlot(9 * 60 + 29)).toBe(555);
  });

  it('stays on the day: above the clock is midnight, the last quarter is 23:45', () => {
    expect(dropSlot(-20)).toBe(0);
    expect(dropSlot(24 * 60)).toBe(23 * 60 + 45);
    expect(dropSlot(24 * 60 + 400)).toBe(23 * 60 + 45);
  });
});

describe('a new block’s times', () => {
  it('runs from the start for the length, written as wall-clock time with no offset', () => {
    expect(newBlockTimes({ start: '2026-10-12T09:15', minutes: 20 })).toEqual({
      start: '2026-10-12T09:15',
      end: '2026-10-12T09:35',
    });
  });

  it('runs past midnight into the next day, and is as long as asked', () => {
    const times = newBlockTimes({ start: '2026-10-14T23:30', minutes: 90 });

    expect(times).toEqual({ start: '2026-10-14T23:30', end: '2026-10-15T01:00' });
    expect(blockMinutes(times!)).toBe(90);
  });

  it('runs into the next year, and the next month, from the last evening of one', () => {
    expect(newBlockTimes({ start: '2026-12-31T23:45', minutes: 30 })?.end).toBe('2027-01-01T00:15');
    expect(newBlockTimes({ start: '2028-02-28T23:00', minutes: 120 })?.end).toBe(
      '2028-02-29T01:00',
    );
  });

  it('drops a zone or seconds written after the time: a block holds no offset', () => {
    expect(newBlockTimes({ start: '2026-10-12T09:00:30+02:00', minutes: 60 })).toEqual({
      start: '2026-10-12T09:00',
      end: '2026-10-12T10:00',
    });
  });

  it('is refused for a start with no time, a day that is not real, or no length', () => {
    expect(newBlockTimes({ start: '2026-10-12', minutes: 60 })).toBeNull();
    expect(newBlockTimes({ start: '2026-02-30T09:00', minutes: 60 })).toBeNull();
    expect(newBlockTimes({ start: 'tomorrow at nine', minutes: 60 })).toBeNull();
    expect(newBlockTimes({ start: '2026-10-12T09:00', minutes: 0 })).toBeNull();
    expect(newBlockTimes({ start: '2026-10-12T09:00', minutes: -30 })).toBeNull();
    expect(newBlockTimes({ start: '2026-10-12T09:00', minutes: 12.5 })).toBeNull();
    expect(newBlockTimes({ start: '2026-10-12T09:00', minutes: Number.NaN })).toBeNull();
  });

  it('is a day long at most', () => {
    expect(newBlockTimes({ start: '2026-10-12T09:00', minutes: 24 * 60 })?.end).toBe(
      '2026-10-13T09:00',
    );
    expect(newBlockTimes({ start: '2026-10-12T09:00', minutes: 24 * 60 + 1 })).toBeNull();
  });

  it('is refused when its end is past the last day a date can hold', () => {
    expect(newBlockTimes({ start: '9999-12-31T23:30', minutes: 60 })).toBeNull();
    expect(newBlockTimes({ start: '9999-12-31T22:30', minutes: 60 })?.end).toBe('9999-12-31T23:30');
  });
});

describe.each(ZONES)('on the nights the clocks change, in %s', (zone) => {
  useZone(zone);

  it('a block made at 01:30 for two hours ends at 03:30 on the clock, the night the clocks go forward', () => {
    const times = newBlockTimes({ start: '2026-03-29T01:30', minutes: 120 });

    expect(times).toEqual({ start: '2026-03-29T01:30', end: '2026-03-29T03:30' });
    expect(blockMinutes(times!)).toBe(120);
  });

  it('a block made at 01:00 for an hour ends at 02:00 on the clock, the night the clocks go back', () => {
    expect(newBlockTimes({ start: '2026-11-01T01:00', minutes: 60 })?.end).toBe('2026-11-01T02:00');
  });
});
