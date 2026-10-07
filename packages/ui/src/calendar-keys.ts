import type { KeyboardEvent } from 'react';
import type { CalendarRange } from '@atlas/domain';
import type { CalendarNavigation } from './calendar-nav.tsx';

/** The keys a focused calendar answers to, and what each one does. */
const RANGE_KEYS: Readonly<Record<string, CalendarRange>> = {
  m: 'month',
  w: 'week',
  '3': '3day',
  d: 'day',
  a: 'agenda',
};

/** Whether a key press belongs to a field being typed in, which the calendar leaves alone. */
function isTyping(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Whether a key press reached the calendar through a portal — "+N more", a
 * menu — rather than from inside it: React bubbles those up its own tree, not
 * the page's, and they belong to what is open.
 */
function isFromPortal(event: KeyboardEvent): boolean {
  const { currentTarget, target } = event;
  return target instanceof Node && !currentTarget.contains(target);
}

/**
 * M, W, 3, D and A choose the range; T goes to today; the arrows, [ and ] page.
 *
 * A key with ⌘, Ctrl or Alt held is someone else's — ⌘[ and ⌘] go back and
 * forward — and so is one pressed while a note is held, whose arrows move it.
 * Returns whether the key was taken.
 */
export function answerCalendarKey({
  event,
  calendar,
  holding,
}: {
  event: KeyboardEvent;
  calendar: CalendarNavigation;
  holding: boolean;
}): boolean {
  if (holding || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  if (isTyping(event.target) || isFromPortal(event)) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const range = RANGE_KEYS[key];
  if (range !== undefined) calendar.setRange(range);
  else if (key === 't') calendar.toToday();
  else if (key === 'ArrowLeft' || key === '[') calendar.previous();
  else if (key === 'ArrowRight' || key === ']') calendar.next();
  else return false;
  event.preventDefault();
  return true;
}
