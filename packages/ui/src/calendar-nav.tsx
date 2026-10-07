import { useState } from 'react';
import { rangeTitle, rangeUnit, stepAnchor, type CalendarRange } from '@atlas/domain';
import { Icon } from './icon.tsx';
import { SegmentedControl, type SegmentedOption } from './segmented-control.tsx';

/** What a calendar view shows — how much, from when — and the ways to change it. */
export interface CalendarNavigation {
  readonly range: CalendarRange;
  /** The day the range is opened on, as `2026-09-24`. */
  readonly anchor: string;
  /** "Sep 21 – 27, 2026". */
  readonly title: string;
  /** What ‹ and › step by, for their labels: "week". */
  readonly unit: string;
  readonly setRange: (range: CalendarRange) => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly toToday: () => void;
}

const RANGE_OPTIONS: readonly SegmentedOption<CalendarRange>[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: '3day', label: '3 days' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
];

/**
 * The range and the day a calendar shows, held above the calendar so the
 * view's toolbar can change them while the body draws them.
 *
 * The range belongs to the view — it is saved in the view note like its
 * layout — so it is handed in with the way to change it. The day is only
 * where the person is looking: `resetKey` is the view shown, and opening
 * another starts again on today.
 */
export function useCalendarNav({
  today,
  resetKey,
  range,
  onRange,
}: {
  today: string;
  resetKey: string | null;
  range: CalendarRange;
  onRange: (range: CalendarRange) => void;
}): CalendarNavigation {
  const [shown, setShown] = useState({ key: resetKey, anchor: today });
  const anchor = shown.key === resetKey ? shown.anchor : today;
  const show = (next: string) => setShown({ key: resetKey, anchor: next });
  const step = (by: number) => show(stepAnchor({ range, anchor, by }));

  return {
    range,
    anchor,
    title: rangeTitle(range, anchor),
    unit: rangeUnit(range),
    setRange: onRange,
    previous: () => step(-1),
    next: () => step(1),
    toToday: () => show(today),
  };
}

/** Month · Week · 3 days · Day · Agenda, then ‹ the range's title › and Today, for the view's toolbar. */
export function CalendarNav({ calendar }: { calendar: CalendarNavigation }) {
  return (
    <div className="calendar-nav">
      <SegmentedControl
        label="Calendar range"
        options={RANGE_OPTIONS}
        value={calendar.range}
        onChange={calendar.setRange}
      />
      <div className="month-nav" role="group" aria-label="Calendar dates">
        <button
          type="button"
          className="month-nav__step"
          onClick={calendar.previous}
          aria-label={`Previous ${calendar.unit}`}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="month-nav__label" aria-live="polite">
          {calendar.title}
        </span>
        <button
          type="button"
          className="month-nav__step"
          onClick={calendar.next}
          aria-label={`Next ${calendar.unit}`}
        >
          <Icon name="chevron-right" size={16} />
        </button>
        <button type="button" className="month-nav__today" onClick={calendar.toToday}>
          Today
        </button>
      </div>
    </div>
  );
}
