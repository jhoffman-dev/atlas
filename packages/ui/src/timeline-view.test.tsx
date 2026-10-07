// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardRow } from '@atlas/domain';
import { TimelineView } from './timeline-view.tsx';
import { announced, dragByKeyboard, layOut } from './drag/test-layout.ts';

const rows: BoardRow[] = [
  {
    path: 'a.md',
    title: 'Design',
    values: { id: 'A', scheduled: '2026-09-01', due: '2026-09-03' },
  },
  {
    path: 'b.md',
    title: 'Build',
    values: { id: 'B', scheduled: '2026-09-04', due: '2026-09-08', blocked_by: ['A'] },
  },
  { path: 'c.md', title: 'Ship', values: { id: 'C', due: '2026-09-09', blocked_by: ['B'] } },
  { path: 'd.md', title: 'Someday', values: {} },
];

const props = {
  rows,
  startKey: 'scheduled',
  endKey: 'due',
  today: '2026-09-05',
  onOpenNote: () => {},
  onReschedule: () => {},
};

describe('TimelineView', () => {
  it('says what a note needs when nothing is dated', () => {
    render(<TimelineView {...props} rows={[{ path: 'a.md', title: 'A', values: {} }]} />);
    expect(screen.getByText(/Nothing on this timeline yet/)).toBeDefined();
  });

  it('draws a bar per dated note', () => {
    const { container } = render(<TimelineView {...props} />);
    expect(container.querySelectorAll('.timeline__bar')).toHaveLength(3);
  });

  it('shows the range it covers', () => {
    render(<TimelineView {...props} />);
    expect(screen.getByText('Tue, Sep 1, 2026 → Wed, Sep 9, 2026')).toBeDefined();
  });

  it('counts the notes it could not place rather than hiding them', () => {
    render(<TimelineView {...props} />);
    expect(screen.getByText('1 with no scheduled')).toBeDefined();
  });

  it('sizes a bar by the days it covers', () => {
    const { container } = render(<TimelineView {...props} />);
    const design = container.querySelector<HTMLElement>('[data-path="a.md"]');
    expect(design?.style.width).toBe('78px');
    expect(design?.style.marginLeft).toBe('0px');
  });

  it('places a bar by where it starts in the range', () => {
    const { container } = render(<TimelineView {...props} />);
    expect(container.querySelector<HTMLElement>('[data-path="b.md"]')?.style.marginLeft).toBe(
      '78px',
    );
  });

  it('draws a note with one date as a milestone', () => {
    const { container } = render(<TimelineView {...props} />);
    expect(container.querySelector('[data-path="c.md"]')?.className).toContain(
      'timeline__bar--milestone',
    );
  });

  it('picks out the chain that decides the end date', () => {
    const { container } = render(<TimelineView {...props} />);
    const critical = [...container.querySelectorAll('.timeline__bar--critical')].map((bar) =>
      bar.getAttribute('data-path'),
    );
    expect(critical).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('leaves work off the critical path unmarked', () => {
    const { container } = render(
      <TimelineView
        {...props}
        rows={[
          {
            path: 'a.md',
            title: 'Long',
            values: { id: 'A', scheduled: '2026-09-01', due: '2026-09-10' },
          },
          {
            path: 'b.md',
            title: 'Aside',
            values: { id: 'B', scheduled: '2026-09-01', due: '2026-09-02' },
          },
        ]}
      />,
    );
    expect(container.querySelector('[data-path="b.md"]')?.className).not.toContain('critical');
  });

  it('says so when the dependencies loop', () => {
    render(
      <TimelineView
        {...props}
        rows={[
          {
            path: 'a.md',
            title: 'A',
            values: { id: 'A', scheduled: '2026-09-01', due: '2026-09-02', blocked_by: ['B'] },
          },
          {
            path: 'b.md',
            title: 'B',
            values: { id: 'B', scheduled: '2026-09-03', due: '2026-09-04', blocked_by: ['A'] },
          },
        ]}
      />,
    );
    expect(screen.getByText(/block each other in a loop/)).toBeDefined();
  });

  it('names a blocker that matches no task', () => {
    render(
      <TimelineView
        {...props}
        rows={[
          {
            path: 'a.md',
            title: 'A',
            values: { id: 'A', scheduled: '2026-09-01', blocked_by: ['GHOST'] },
          },
        ]}
      />,
    );
    expect(screen.getByText(/GHOST/)).toBeDefined();
  });

  it('names an id that more than one note claims', () => {
    render(
      <TimelineView
        {...props}
        rows={[
          {
            path: 'a.md',
            title: 'A',
            values: { id: 'DUP', scheduled: '2026-09-01', due: '2026-09-02' },
          },
          {
            path: 'b.md',
            title: 'B',
            values: { id: 'DUP', scheduled: '2026-09-03', due: '2026-09-04' },
          },
        ]}
      />,
    );
    expect(screen.getByText(/More than one note claims: DUP/)).toBeDefined();
  });

  it('marks today when it falls inside the range', () => {
    render(<TimelineView {...props} />);
    expect(screen.getByLabelText('Today')).toBeDefined();
  });

  it('does not mark today when the plan is elsewhere', () => {
    render(<TimelineView {...props} today="2027-01-01" />);
    expect(screen.queryByLabelText('Today')).toBeNull();
  });

  it('opens the note behind a bar', async () => {
    const onOpenNote = vi.fn();
    render(<TimelineView {...props} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Design' }));
    expect(onOpenNote).toHaveBeenCalledWith('a.md');
  });

  /**
   * Milestones used to be a rotated button, which turned the label with it, so
   * the label was hidden — leaving a column of diamonds nobody could tell
   * apart. The name has to be readable, and the button is what carries it.
   */
  it('names a milestone, rather than leaving a diamond to guess at', () => {
    render(
      <TimelineView
        {...props}
        rows={[{ path: 'c.md', title: 'Ship', values: { id: 'C', due: '2026-09-09' } }]}
      />,
    );

    const milestone = screen.getByRole('button', { name: 'Ship' });
    expect(milestone.className).toContain('timeline__bar--milestone');
    expect(milestone.textContent).toBe('Ship');
  });
});

describe('TimelineView keyboard drag', () => {
  // jsdom lays nothing out; the sensor only needs the bars to have a box.
  beforeEach(() =>
    layOut((element) =>
      element.matches('.timeline__bar') ? { left: 100, top: 40, width: 130, height: 26 } : null,
    ),
  );
  afterEach(() => vi.restoreAllMocks());

  const build = () => screen.getByRole('button', { name: 'Build' });

  it('moves both dates a day for each press, in one write', async () => {
    const onReschedule = vi.fn();
    render(<TimelineView {...props} onReschedule={onReschedule} />);

    await dragByKeyboard(build(), ['{ArrowRight}', '{ArrowRight}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'b.md',
      start: '2026-09-06',
      end: '2026-09-10',
    });
  });

  it('moves earlier with the left arrow', async () => {
    const onReschedule = vi.fn();
    render(<TimelineView {...props} onReschedule={onReschedule} />);

    await dragByKeyboard(build(), ['{ArrowLeft}']);

    expect(onReschedule).toHaveBeenCalledExactlyOnceWith({
      path: 'b.md',
      start: '2026-09-03',
      end: '2026-09-07',
    });
  });

  it('does not move a bar up or down: it only moves in time', async () => {
    const onReschedule = vi.fn();
    render(<TimelineView {...props} onReschedule={onReschedule} />);

    await dragByKeyboard(build(), ['{ArrowDown}', '{ArrowUp}']);

    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('writes nothing when the drag is cancelled with Escape', async () => {
    const onReschedule = vi.fn();
    render(<TimelineView {...props} onReschedule={onReschedule} />);

    await dragByKeyboard(build(), ['{ArrowRight}'], { finish: '{Escape}' });

    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('opens the note on Enter, which does not pick the bar up', async () => {
    const onOpenNote = vi.fn();
    const onReschedule = vi.fn();
    render(<TimelineView {...props} onOpenNote={onOpenNote} onReschedule={onReschedule} />);

    build().focus();
    await userEvent.keyboard('{Enter}');

    expect(onOpenNote).toHaveBeenCalledWith('b.md');
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('tells a screen reader how far the bar moved and where it landed', async () => {
    render(<TimelineView {...props} />);

    await dragByKeyboard(build(), ['{ArrowRight}', '{ArrowRight}']);

    await waitFor(() =>
      expect(announced()).toBe(
        'Build moved 2 days later, from Sunday 6 September 2026 to Thursday 10 September 2026.',
      ),
    );
  });
});
