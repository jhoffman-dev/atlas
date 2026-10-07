import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import { addDays, buildTimeline, daysBetween } from './timeline.ts';

const row = (path: string, values: Record<string, unknown>): BoardRow => ({
  path,
  title: path.replace('.md', ''),
  values,
});

const timeline = (rows: BoardRow[]) =>
  buildTimeline({ rows, startKey: 'scheduled', endKey: 'due' });

describe('daysBetween', () => {
  it('counts the days from one date to another', () => {
    expect(daysBetween('2026-09-01', '2026-09-04')).toBe(3);
  });

  it('counts backwards as a negative', () => {
    expect(daysBetween('2026-09-04', '2026-09-01')).toBe(-3);
  });

  it('counts across a month boundary', () => {
    expect(daysBetween('2026-09-28', '2026-10-02')).toBe(4);
  });

  it('counts across a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('counts nothing between two dates it cannot read', () => {
    expect(daysBetween('soon', '2026-09-01')).toBe(0);
  });
});

describe('addDays', () => {
  it('moves a date on', () => {
    expect(addDays('2026-09-28', 4)).toBe('2026-10-02');
  });

  it('moves a date back', () => {
    expect(addDays('2026-10-02', -4)).toBe('2026-09-28');
  });

  it('says it cannot move a date it cannot read', () => {
    expect(addDays('soon', 3)).toBeNull();
  });

  it('says it cannot move a date past 9999-12-31 or before 0000-01-01', () => {
    expect(addDays('9999-12-31', 1)).toBeNull();
    expect(addDays('0000-01-01', -1)).toBeNull();
    expect(addDays('2026-09-20', 1e12)).toBeNull();
  });
});

describe('buildTimeline', () => {
  it('has no range when nothing is dated', () => {
    const built = timeline([row('a.md', {}), row('b.md', {})]);
    expect(built.entries).toEqual([]);
    expect(built.days).toBe(0);
    expect(built.undated).toBe(2);
  });

  it('counts the notes it could not place', () => {
    const built = timeline([
      row('a.md', { scheduled: '2026-09-01', due: '2026-09-03' }),
      row('b.md', {}),
    ]);
    expect(built.undated).toBe(1);
  });

  it('runs from the first day to the last', () => {
    const built = timeline([
      row('a.md', { scheduled: '2026-09-05', due: '2026-09-08' }),
      row('b.md', { scheduled: '2026-09-01', due: '2026-09-03' }),
    ]);
    expect(built.start).toBe('2026-09-01');
    expect(built.end).toBe('2026-09-08');
    expect(built.days).toBe(8);
  });

  it('places a bar by how far it starts into the range', () => {
    const built = timeline([
      row('a.md', { scheduled: '2026-09-01', due: '2026-09-02' }),
      row('b.md', { scheduled: '2026-09-05', due: '2026-09-06' }),
    ]);
    expect(built.entries.map((entry) => entry.offset)).toEqual([0, 4]);
  });

  it('counts both ends of a bar, so one day is one day wide', () => {
    const built = timeline([row('a.md', { scheduled: '2026-09-01', due: '2026-09-01' })]);
    expect(built.entries[0]?.span).toBe(1);
  });

  it('measures a bar inclusively', () => {
    const built = timeline([row('a.md', { scheduled: '2026-09-01', due: '2026-09-03' })]);
    expect(built.entries[0]?.span).toBe(3);
  });

  it('reads a note with one date as a milestone', () => {
    const built = timeline([row('a.md', { due: '2026-09-04' })]);
    expect(built.entries[0]).toMatchObject({
      start: '2026-09-04',
      end: '2026-09-04',
      milestone: true,
    });
  });

  it('reads a note with only a start as a milestone too', () => {
    const built = timeline([row('a.md', { scheduled: '2026-09-04' })]);
    expect(built.entries[0]?.milestone).toBe(true);
  });

  it('does not call a bar a milestone', () => {
    const built = timeline([row('a.md', { scheduled: '2026-09-01', due: '2026-09-03' })]);
    expect(built.entries[0]?.milestone).toBe(false);
  });

  it('reads a plan written backwards as a single day rather than a bar running the wrong way', () => {
    const built = timeline([row('a.md', { scheduled: '2026-09-09', due: '2026-09-01' })]);
    expect(built.entries[0]).toMatchObject({ start: '2026-09-01', end: '2026-09-09', span: 9 });
  });

  it('ignores a date it cannot read', () => {
    const built = timeline([row('a.md', { scheduled: 'next week', due: '2026-09-04' })]);
    expect(built.entries[0]?.milestone).toBe(true);
  });

  it('ignores a date that is not a date at all', () => {
    const built = timeline([row('a.md', { scheduled: 42, due: true })]);
    expect(built.undated).toBe(1);
  });

  it('puts the earliest first', () => {
    const built = timeline([
      row('later.md', { scheduled: '2026-09-05', due: '2026-09-06' }),
      row('earlier.md', { scheduled: '2026-09-01', due: '2026-09-02' }),
    ]);
    expect(built.entries.map((entry) => entry.title)).toEqual(['earlier', 'later']);
  });

  it('breaks a tie by name, so a redraw does not reshuffle', () => {
    const built = timeline([
      row('beta.md', { scheduled: '2026-09-01', due: '2026-09-02' }),
      row('alpha.md', { scheduled: '2026-09-01', due: '2026-09-02' }),
    ]);
    expect(built.entries.map((entry) => entry.title)).toEqual(['alpha', 'beta']);
  });

  it("carries the note's other fields through", () => {
    const built = timeline([
      row('a.md', { scheduled: '2026-09-01', due: '2026-09-02', status: 'doing' }),
    ]);
    expect(built.entries[0]?.values['status']).toBe('doing');
  });
});
