// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardRow } from '@atlas/domain';
import { shown } from './calendar-test-support.ts';
import { CalendarView } from './calendar-view.tsx';
import { announced, dragByKeyboard, layOut, type Box } from './drag/test-layout.ts';

const rows: BoardRow[] = [
  { path: 'a.md', title: 'Due today', values: { due: '2026-09-20' } },
  { path: 'b.md', title: 'Due later', values: { due: '2026-09-25' } },
  { path: 'c.md', title: 'No date', values: { due: null } },
];

const props = {
  rows,
  dateKey: 'due',
  calendar: shown('month', '2026-09-20'),
  today: '2026-09-20',
  onOpenNote: () => {},
  onReschedule: () => {},
};

describe('CalendarView', () => {
  it('draws the month it is given, not the one today is in', () => {
    render(<CalendarView {...props} calendar={shown('month', '2026-08-15')} />);
    expect(screen.getByLabelText('2026-08-01')).toBeDefined();
    expect(screen.queryByLabelText('2026-09-20')).toBeNull();
  });

  it('places a note on the day its date names', () => {
    render(<CalendarView {...props} />);
    const day = screen.getByLabelText('2026-09-20');
    expect(day.textContent).toContain('Due today');
  });

  it('does not place a note with no date', () => {
    render(<CalendarView {...props} />);
    expect(screen.queryByRole('button', { name: 'No date' })).toBeNull();
  });

  it('says how many notes are not scheduled, rather than hiding them silently', () => {
    render(<CalendarView {...props} />);
    expect(screen.getByText('1 with no due')).toBeDefined();
  });

  it('opens a note when its entry is clicked', async () => {
    const onOpenNote = vi.fn();
    render(<CalendarView {...props} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Due today' }));
    expect(onOpenNote).toHaveBeenCalledWith('a.md');
  });

  it('opens a note on Enter, which does not pick it up', async () => {
    const onOpenNote = vi.fn();
    const onReschedule = vi.fn();
    render(<CalendarView {...props} onOpenNote={onOpenNote} onReschedule={onReschedule} />);

    screen.getByRole('button', { name: 'Due today' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(onOpenNote).toHaveBeenCalledWith('a.md');
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('places a note with a time on its day, whatever the time', () => {
    render(
      <CalendarView
        {...props}
        rows={[{ path: 'a.md', title: 'Timed', values: { due: '2026-09-22T09:30:00Z' } }]}
      />,
    );
    expect(screen.getByLabelText('2026-09-22').textContent).toContain('Timed');
  });
});

/**
 * Days laid out as the grid draws them: seven 100px columns, one row a week.
 * A note sits inside its day. September 2026's grid starts on Monday 31 August,
 * so the 20th is a Sunday, at the end of the third row.
 */
function calendarBoxes(element: Element): Box | null {
  const days = [...document.querySelectorAll('.calendar__day')];
  const dayBox = (day: Element): Box => {
    const index = days.indexOf(day);
    return { left: (index % 7) * 100, top: Math.floor(index / 7) * 100, width: 90, height: 90 };
  };
  if (element.matches('.calendar__day')) return dayBox(element);
  const day = element.closest('.calendar__day');
  if (element.matches('.calendar__entry') && day !== null) {
    const { left, top } = dayBox(day);
    return { left: left + 5, top: top + 30, width: 80, height: 20 };
  }
  return null;
}

describe('CalendarView keyboard drag', () => {
  beforeEach(() => layOut(calendarBoxes));
  afterEach(() => vi.restoreAllMocks());

  const handle = (title: string) => screen.getByRole('button', { name: title });

  it('moves a note a day with the side arrows, running on into the next week', async () => {
    const onReschedule = vi.fn();
    render(<CalendarView {...props} onReschedule={onReschedule} />);

    // Sunday the 20th is the last day of its row; one to the right is Monday.
    await dragByKeyboard(handle('Due today'), ['{ArrowRight}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      start: '2026-09-21',
      end: null,
    });
  });

  it('moves a note a week with the up and down arrows', async () => {
    const onReschedule = vi.fn();
    render(<CalendarView {...props} onReschedule={onReschedule} />);

    await dragByKeyboard(handle('Due today'), ['{ArrowDown}', '{ArrowLeft}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      start: '2026-09-26',
      end: null,
    });
  });

  it('stops at the edge of the grid rather than turning the month', async () => {
    const onReschedule = vi.fn();
    render(
      <CalendarView
        {...props}
        rows={[{ path: 'e.md', title: 'Early', values: { due: '2026-09-01' } }]}
        onReschedule={onReschedule}
      />,
    );

    // The 1st is in the top row: Up has nowhere to go, and Right then moves
    // from the 1st, not from wherever a wrap would have left it.
    await dragByKeyboard(handle('Early'), ['{ArrowUp}', '{ArrowRight}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'e.md',
      start: '2026-09-02',
      end: null,
    });
    expect(screen.getByLabelText('2026-09-20')).toBeDefined();
  });

  it('writes nothing when the drag is cancelled with Escape', async () => {
    const onReschedule = vi.fn();
    render(<CalendarView {...props} onReschedule={onReschedule} />);

    await dragByKeyboard(handle('Due today'), ['{ArrowDown}'], { finish: '{Escape}' });

    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('tells a screen reader the note and the day, not ids', async () => {
    render(<CalendarView {...props} />);

    await dragByKeyboard(handle('Due today'), ['{ArrowRight}']);

    await waitFor(() => expect(announced()).toBe('Due today moved to Monday 21 September 2026.'));
  });
});

describe('a crowded day in the month', () => {
  const crowded: BoardRow[] = ['One', 'Two', 'Three', 'Four', 'Five'].map((title) => ({
    path: `${title}.md`,
    title,
    values: { due: '2026-09-22' },
  }));

  it('shows what fits and "+N more" for the rest, which lists them', async () => {
    const onOpenNote = vi.fn();
    render(<CalendarView {...props} rows={crowded} onOpenNote={onOpenNote} />);
    const day = screen.getByRole('group', { name: '2026-09-22' });
    expect(day.querySelectorAll('.calendar__entry')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: '+3 more' }));
    const more = await screen.findByRole('dialog', { name: 'More on 2026-09-22' });
    await userEvent.click(within(more).getByRole('button', { name: 'Two' }));
    expect(onOpenNote).toHaveBeenCalledWith('Two.md');
  });

  it('leaves keys pressed in "+N more" to the list, not to paging the calendar', async () => {
    const calendar = shown('month', '2026-09-20');
    render(<CalendarView {...props} calendar={calendar} rows={crowded} />);

    await userEvent.click(screen.getByRole('button', { name: '+3 more' }));
    const more = await screen.findByRole('dialog', { name: 'More on 2026-09-22' });
    within(more).getByRole('button', { name: 'Two' }).focus();
    await userEvent.keyboard('{ArrowRight}]wt');

    expect(calendar.next).not.toHaveBeenCalled();
    expect(calendar.setRange).not.toHaveBeenCalled();
    expect(calendar.toToday).not.toHaveBeenCalled();
  });

  it('has no "+N more" when everything fits', () => {
    render(<CalendarView {...props} rows={crowded.slice(0, 3)} />);
    const day = screen.getByLabelText('2026-09-22');
    expect(day.querySelectorAll('.calendar__entry')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });
});

describe('the month keeping a date’s shape', () => {
  beforeEach(() => layOut(calendarBoxes));
  afterEach(() => vi.restoreAllMocks());

  it('keeps the time when a timed note is moved to another day', async () => {
    const onReschedule = vi.fn();
    render(
      <CalendarView
        {...props}
        rows={[{ path: 't.md', title: 'Timed', values: { due: '2026-09-20T09:30:00Z' } }]}
        onReschedule={onReschedule}
      />,
    );

    await dragByKeyboard(screen.getByRole('button', { name: 'Timed' }), ['{ArrowRight}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 't.md',
      start: '2026-09-21T09:30:00Z',
      end: null,
    });
  });

  it('adds a note on a day when its empty space is clicked', async () => {
    const onCreate = vi.fn();
    render(<CalendarView {...props} onCreate={onCreate} />);

    await userEvent.click(screen.getByLabelText('2026-09-23'));
    await userEvent.keyboard('Plan{Enter}');

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ value: '2026-09-23', name: 'Plan' });
  });
});
