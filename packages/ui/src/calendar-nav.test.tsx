// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CalendarRange } from '@atlas/domain';
import { CalendarNav, useCalendarNav } from './calendar-nav.tsx';
import { CalendarView } from './calendar-view.tsx';

/** The toolbar's nav and the body, sharing one range and day as the pane does. */
function Calendar({
  today,
  view,
  initial = 'month',
}: {
  today: string;
  view: string;
  initial?: CalendarRange;
}) {
  const [range, setRange] = useState<CalendarRange>(initial);
  const calendar = useCalendarNav({ today, resetKey: view, range, onRange: setRange });
  return (
    <>
      <CalendarNav calendar={calendar} />
      <CalendarView
        rows={[]}
        dateKey="due"
        calendar={calendar}
        today={today}
        onOpenNote={() => {}}
        onReschedule={() => {}}
      />
    </>
  );
}

const nav = () => within(screen.getByRole('group', { name: 'Calendar dates' }));
const title = () => nav().getByText(/\d/);
const choose = (range: string) =>
  userEvent.click(
    within(screen.getByRole('radiogroup', { name: 'Calendar range' })).getByRole('radio', {
      name: range,
    }),
  );

describe('the calendar nav', () => {
  it('opens on the month containing today', () => {
    render(<Calendar today="2026-09-20" view="Calendar.md" />);
    expect(title().textContent).toBe('September 2026');
    expect(screen.getByLabelText('2026-09-20')).toBeDefined();
  });

  it('turns the grid a month back and forward', async () => {
    render(<Calendar today="2026-09-20" view="Calendar.md" />);
    await userEvent.click(nav().getByRole('button', { name: 'Previous month' }));
    expect(title().textContent).toBe('August 2026');
    expect(screen.getByLabelText('2026-08-01')).toBeDefined();

    await userEvent.click(nav().getByRole('button', { name: 'Next month' }));
    await userEvent.click(nav().getByRole('button', { name: 'Next month' }));
    expect(title().textContent).toBe('October 2026');
    expect(screen.getByLabelText('2026-10-31')).toBeDefined();
  });

  it('turns across a year', async () => {
    render(<Calendar today="2026-01-10" view="Calendar.md" />);
    await userEvent.click(nav().getByRole('button', { name: 'Previous month' }));
    expect(title().textContent).toBe('December 2025');
  });

  it('comes back to today', async () => {
    render(<Calendar today="2026-09-20" view="Calendar.md" />);
    await userEvent.click(nav().getByRole('button', { name: 'Previous month' }));
    await userEvent.click(nav().getByRole('button', { name: 'Today' }));
    expect(title().textContent).toBe('September 2026');
  });

  it('starts again on today when another view is opened', async () => {
    const { rerender } = render(<Calendar today="2026-09-20" view="Calendar.md" />);
    await userEvent.click(nav().getByRole('button', { name: 'Next month' }));
    expect(title().textContent).toBe('October 2026');

    rerender(<Calendar today="2026-09-20" view="Milestones.md" />);
    expect(title().textContent).toBe('September 2026');
  });

  it('switches range, titling and stepping by it', async () => {
    render(<Calendar today="2026-09-24" view="Calendar.md" />);

    await choose('Week');
    expect(title().textContent).toBe('Sep 21 – 27, 2026');
    await userEvent.click(nav().getByRole('button', { name: 'Next week' }));
    expect(title().textContent).toBe('Sep 28 – Oct 4, 2026');

    await choose('3 days');
    expect(title().textContent).toBe('Oct 1 – 3');
    await userEvent.click(nav().getByRole('button', { name: 'Previous 3 days' }));
    expect(title().textContent).toBe('Sep 28 – 30');

    await choose('Day');
    expect(title().textContent).toBe('Mon, Sep 28, 2026');

    await choose('Agenda');
    expect(title().textContent).toBe('From Sep 28');

    await userEvent.click(nav().getByRole('button', { name: 'Today' }));
    expect(title().textContent).toBe('From Sep 24');
  });

  it('answers the range keys, T and the arrows when the calendar has focus', async () => {
    render(<Calendar today="2026-09-24" view="Calendar.md" />);
    screen.getByRole('region', { name: 'Calendar' }).focus();

    await userEvent.keyboard('w');
    expect(title().textContent).toBe('Sep 21 – 27, 2026');
    await userEvent.keyboard('{ArrowRight}');
    expect(title().textContent).toBe('Sep 28 – Oct 4, 2026');
    await userEvent.keyboard('3');
    expect(title().textContent).toBe('Oct 1 – 3');
    await userEvent.keyboard('[[');
    expect(title().textContent).toBe('Sep 28 – 30');
    await userEvent.keyboard('t');
    expect(title().textContent).toBe('Sep 24 – 26');
    await userEvent.keyboard('d');
    expect(title().textContent).toBe('Thu, Sep 24, 2026');
    await userEvent.keyboard(']');
    expect(title().textContent).toBe('Fri, Sep 25, 2026');
    await userEvent.keyboard('a');
    expect(title().textContent).toBe('From Sep 25');
    await userEvent.keyboard('{ArrowLeft}');
    expect(title().textContent).toBe('From Aug 26');
    await userEvent.keyboard('m');
    expect(title().textContent).toBe('August 2026');
  });

  it('leaves keys held with ⌘ or Ctrl to the app: ⌘[ is back, not the previous range', async () => {
    render(<Calendar today="2026-09-24" view="Calendar.md" initial="week" />);
    screen.getByRole('region', { name: 'Calendar' }).focus();

    await userEvent.keyboard('{Meta>}[[{/Meta}{Control>}]{/Control}{Alt>}m{/Alt}');
    expect(title().textContent).toBe('Sep 21 – 27, 2026');
  });
});
