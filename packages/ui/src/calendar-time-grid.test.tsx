// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardRow } from '@atlas/domain';
import { shown } from './calendar-test-support.ts';
import { CalendarView } from './calendar-view.tsx';
import { announced, dragByKeyboard, layOut, type Box } from './drag/test-layout.ts';

const rows: BoardRow[] = [
  { path: 'meet.md', title: 'Meeting', values: { due: '2026-09-22T14:30', end: null } },
  { path: 'trip.md', title: 'Trip', values: { due: '2026-09-22', end: null } },
  { path: 'call.md', title: 'Call', values: { due: '2026-09-22T14:45', end: null } },
  {
    path: 'long.md',
    title: 'Review',
    values: { due: '2026-09-24T09:00', end: '2026-09-24T10:00' },
  },
];

const props = {
  rows,
  dateKey: 'due',
  calendar: shown('week', '2026-09-22'),
  today: '2026-09-22',
  now: 600,
  onOpenNote: () => {},
  onReschedule: () => {},
};

const column = (date: string) => screen.getByLabelText(date, { exact: true });
const note = (path: string) => document.querySelector(`.clock__note[data-path="${path}"]`);

describe('the week, three days and a day', () => {
  it.each([
    [
      'week',
      [
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
      ],
    ],
    ['3day', ['2026-09-22', '2026-09-23', '2026-09-24']],
    ['day', ['2026-09-22']],
  ] as const)('draws a %s as a column a day', (range, days) => {
    render(<CalendarView {...props} calendar={shown(range, '2026-09-22')} />);
    const columns = [...document.querySelectorAll('.clock__column')];
    expect(columns.map((element) => element.getAttribute('aria-label'))).toEqual(days);
  });

  it('puts a timed note on its day’s clock, from its time for half an hour', () => {
    render(<CalendarView {...props} />);
    const meeting = within(column('2026-09-22')).getByRole('button', { name: /Meeting/ });
    const box = meeting.closest('article') as HTMLElement;
    // 14:30 is 870 minutes in, drawn at 48px an hour.
    expect(box.style.top).toBe('696px');
    expect(box.style.height).toBe('24px');
    expect(meeting.textContent).toContain('14:30');
  });

  it('spans a note to its end, when the view reads one', () => {
    render(<CalendarView {...props} endKey="end" />);
    const review = note('long.md') as HTMLElement;
    expect(review.style.height).toBe('48px');
    expect(review.textContent).toContain('09:00 – 10:00');
  });

  it('puts a date with no time in the all-day strip, not on the clock', () => {
    render(<CalendarView {...props} />);
    const strip = screen.getByLabelText('All day 2026-09-22');
    expect(within(strip).getByRole('button', { name: 'Trip' })).toBeDefined();
    expect(within(column('2026-09-22')).queryByRole('button', { name: /Trip/ })).toBeNull();
  });

  it('shares the width between notes that overlap', () => {
    render(<CalendarView {...props} />);
    expect((note('meet.md') as HTMLElement).style.width).toBe('50%');
    expect((note('call.md') as HTMLElement).style.left).toBe('50%');
    expect((note('long.md') as HTMLElement).style.width).toBe('100%');
  });

  it('draws the line for now across today only', () => {
    render(<CalendarView {...props} />);
    const line = column('2026-09-22').querySelector('.clock__now') as HTMLElement;
    expect(line.style.top).toBe('480px');
    expect(document.querySelectorAll('.clock__now')).toHaveLength(1);
  });

  it('opens a note when it is clicked', async () => {
    const onOpenNote = vi.fn();
    render(<CalendarView {...props} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: /Meeting/ }));
    expect(onOpenNote).toHaveBeenCalledWith('meet.md');
  });
});

/** Seven 100px columns; every note and handle a small box inside its column. */
function clockBoxes(element: Element): Box | null {
  if (element.matches('.clock__columns')) return { left: 0, top: 0, width: 700, height: 1152 };
  if (element.matches('.clock__column')) return { left: 0, top: 100, width: 100, height: 1152 };
  if (element.matches('.clock__note, .clock__end'))
    return { left: 10, top: 10, width: 80, height: 20 };
  return null;
}

describe('dragging on the clock', () => {
  beforeEach(() => layOut(clockBoxes));
  afterEach(() => vi.restoreAllMocks());

  const handle = (name: RegExp | string) => screen.getByRole('button', { name });

  it('moves a note a day along and a quarter hour at a time, keeping its shape', async () => {
    const onReschedule = vi.fn();
    const calendar = shown('week', '2026-09-22');
    render(<CalendarView {...props} calendar={calendar} onReschedule={onReschedule} />);

    await dragByKeyboard(handle(/Meeting/), ['{ArrowRight}', '{ArrowDown}', '{ArrowDown}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'meet.md',
      start: '2026-09-23T15:00',
      end: null,
    });
    // The arrows moved the note, not the week.
    expect(calendar.next).not.toHaveBeenCalled();
  });

  it('moves an all-day note by days only', async () => {
    const onReschedule = vi.fn();
    render(<CalendarView {...props} onReschedule={onReschedule} />);

    await dragByKeyboard(handle('Trip'), ['{ArrowDown}', '{ArrowRight}', '{ArrowRight}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'trip.md',
      start: '2026-09-24',
      end: null,
    });
  });

  it('moves the end with the note, so it keeps its length', async () => {
    const onReschedule = vi.fn();
    render(<CalendarView {...props} endKey="end" onReschedule={onReschedule} />);

    await dragByKeyboard(handle(/^Review/), ['{ArrowUp}', '{ArrowUp}', '{ArrowUp}', '{ArrowUp}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'long.md',
      start: '2026-09-24T08:00',
      end: '2026-09-24T09:00',
    });
  });

  it('changes when a note ends from its end handle, when the view reads an end', async () => {
    const onReschedule = vi.fn();
    render(<CalendarView {...props} endKey="end" onReschedule={onReschedule} />);

    await dragByKeyboard(handle('Change when Review ends'), ['{ArrowDown}', '{ArrowDown}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'long.md',
      start: '2026-09-24T09:00',
      end: '2026-09-24T10:30',
    });
    await waitFor(() =>
      expect(announced()).toBe('Review is now ending Thursday 24 September 2026 at 10:30.'),
    );
  });

  it('stretches only the last piece of a note that runs past midnight, and ends it there', async () => {
    const onReschedule = vi.fn();
    const late: BoardRow = {
      path: 'late.md',
      title: 'Late',
      values: { due: '2026-09-22T22:00', end: '2026-09-23T02:00' },
    };
    render(<CalendarView {...props} rows={[late]} endKey="end" onReschedule={onReschedule} />);
    const piece = (date: string) =>
      within(column(date)).getByRole('button', { name: /^Late/ }).closest('article') as HTMLElement;
    const [first, last] = [piece('2026-09-22'), piece('2026-09-23')];
    const [firstHeight, lastHeight] = [first.style.height, last.style.height];
    expect(screen.getAllByRole('button', { name: 'Change when Late ends' })).toHaveLength(1);

    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Change when Late ends' }).focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(last.style.height).not.toBe(lastHeight));
    expect(first.style.height).toBe(firstHeight);
    await user.keyboard(' ');

    await waitFor(() =>
      expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
        path: 'late.md',
        start: '2026-09-22T22:00',
        end: '2026-09-23T02:30',
      }),
    );
  });

  it('has no end handle when the view reads no end', () => {
    render(<CalendarView {...props} />);
    expect(screen.queryByRole('button', { name: /Change when/ })).toBeNull();
    expect(handle(/Meeting/)).toBeDefined();
  });

  it('writes nothing when a drag is cancelled', async () => {
    const onReschedule = vi.fn();
    render(<CalendarView {...props} onReschedule={onReschedule} />);
    await dragByKeyboard(handle(/Meeting/), ['{ArrowDown}'], { finish: '{Escape}' });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('tells a screen reader where the note would land', async () => {
    render(<CalendarView {...props} />);
    await dragByKeyboard(handle(/Meeting/), ['{ArrowRight}']);
    await waitFor(() =>
      expect(announced()).toBe('Meeting is now on Wednesday 23 September 2026 at 14:30.'),
    );
  });
});

describe('adding a note on the clock', () => {
  beforeEach(() => layOut(clockBoxes));
  afterEach(() => vi.restoreAllMocks());

  it('adds one at the quarter hour clicked, named as typed', async () => {
    const onCreate = vi.fn();
    const calendar = shown('week', '2026-09-22');
    render(<CalendarView {...props} calendar={calendar} onCreate={onCreate} />);

    // 100px is the column's top; 14:37 is 877 minutes, 701.6px, down.
    fireEvent.click(column('2026-09-23'), { clientY: 100 + 877 * 0.8 });
    await userEvent.keyboard('Weekly demo{Enter}');

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      value: '2026-09-23T14:30',
      name: 'Weekly demo',
    });
    // Typing the name is typing, not the calendar's W and D.
    expect(calendar.setRange).not.toHaveBeenCalled();
  });

  it('adds an all-day one from the all-day strip', async () => {
    const onCreate = vi.fn();
    render(<CalendarView {...props} onCreate={onCreate} />);

    fireEvent.click(screen.getByLabelText('All day 2026-09-25'));
    await userEvent.keyboard('Holiday{Enter}');

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ value: '2026-09-25', name: 'Holiday' });
  });

  it('adds nothing when the view cannot add notes', () => {
    render(<CalendarView {...props} />);
    fireEvent.click(column('2026-09-23'), { clientY: 500 });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(column('2026-09-23')).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });
});

describe('the clock for a keyboard and a screen reader', () => {
  it('names each day’s column and all-day cell as a group', () => {
    render(<CalendarView {...props} />);
    expect(screen.getByRole('group', { name: '2026-09-22' })).toBe(column('2026-09-22'));
    expect(screen.getByRole('group', { name: 'All day 2026-09-22' })).toBeDefined();
  });

  it('adds a note at an hour from the keyboard: to the day, down the hours, Enter', async () => {
    const onCreate = vi.fn();
    const calendar = shown('week', '2026-09-22');
    render(<CalendarView {...props} calendar={calendar} onCreate={onCreate} />);
    const day = within(column('2026-09-23'));
    const nine = day.getByRole('button', { name: 'Add at 09:00 on Wednesday 23 September 2026' });
    // One stop a day: the other hours are reached with the arrows.
    expect(nine.tabIndex).toBe(0);
    expect(day.getByRole('button', { name: /^Add at 10:00/ }).tabIndex).toBe(-1);

    nine.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(document.activeElement).toBe(day.getByRole('button', { name: /^Add at 10:00/ }));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('Standup{Enter}');

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      value: '2026-09-23T10:00',
      name: 'Standup',
    });
    expect(calendar.next).not.toHaveBeenCalled();
  });

  it('adds an all-day note from the keyboard', async () => {
    const onCreate = vi.fn();
    render(<CalendarView {...props} onCreate={onCreate} />);
    screen.getByRole('button', { name: 'Add an all-day note on Friday 25 September 2026' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('Holiday{Enter}');
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ value: '2026-09-25', name: 'Holiday' });
  });
});
