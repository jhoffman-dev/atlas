// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { TaskSchedule } from '@atlas/domain';
import { TaskScheduleSummary } from './task-schedule.tsx';

/** P31-01: a task shows its estimate beside what its blocks schedule and what is done. */
function shown(schedule: TaskSchedule) {
  render(<TaskScheduleSummary schedule={schedule} />);
  const section = screen.getByRole('region', { name: 'Schedule' });
  const row = (label: string) =>
    within(section)
      .queryAllByRole('definition')
      .find((value) => value.previousElementSibling?.textContent === label)?.textContent ?? null;
  return { scheduled: row('Scheduled'), done: row('Done') };
}

describe('TaskScheduleSummary', () => {
  it('shows a 2h task split over blocks as 2h scheduled of 2h, none of it done', () => {
    expect(shown({ estimate: 120, scheduled: 120, done: 0, overBy: 0 })).toEqual({
      scheduled: '2h of 2h',
      done: '0m of 2h',
    });
  });

  it('says how far a task is scheduled past its estimate', () => {
    expect(shown({ estimate: 60, scheduled: 90, done: 0, overBy: 30 }).scheduled).toBe(
      '1h 30m of 1h30m over the estimate',
    );
  });

  it('shows a finished task as all done', () => {
    expect(shown({ estimate: 45, scheduled: 30, done: 45, overBy: 0 }).done).toBe('45m of 45m');
  });

  it('shows the time scheduled alone for a task with no estimate, and no done', () => {
    expect(shown({ estimate: null, scheduled: 50, done: null, overBy: 0 })).toEqual({
      scheduled: '50mno estimate',
      done: null,
    });
  });

  it('says why when the schedule could not be read', () => {
    render(<TaskScheduleSummary problem="the index is busy" />);
    expect(screen.getByRole('alert').textContent).toBe(
      'The schedule could not be read: the index is busy',
    );
    expect(screen.queryByText('Scheduled')).toBeNull();
  });
});
