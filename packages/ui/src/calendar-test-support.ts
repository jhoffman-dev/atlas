/**
 * Test support: a calendar held still on one range and day, for drawing a
 * layout without the toolbar that pages it.
 */
import { vi } from 'vitest';
import { rangeTitle, type CalendarRange } from '@atlas/domain';
import type { CalendarNavigation } from './calendar-nav.tsx';

/** Each way of changing what is shown is a spy, so a test can see it was asked for. */
export function shown(range: CalendarRange, anchor: string): CalendarNavigation {
  return {
    range,
    anchor,
    title: rangeTitle(range, anchor),
    unit: range,
    setRange: vi.fn(),
    previous: vi.fn(),
    next: vi.fn(),
    toToday: vi.fn(),
  };
}
