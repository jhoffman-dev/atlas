import type { CalendarEvent } from '@atlas/domain';

/**
 * What a calendar's layouts can do with a note, worked out once by
 * `CalendarView` from the view's properties, so a month, a week and an agenda
 * each only say what the person did.
 */
export interface CalendarGestures {
  readonly open: (path: string) => void;
  /** Moves a note `days` along and `minutes` down the clock, keeping its length. */
  readonly move: (event: CalendarEvent, by: ClockGesture) => void;
  /** Whether a note's end can be dragged: only when the view reads an end property. */
  readonly canResize: boolean;
  /** Drags a timed note's end `minutes` later (earlier when negative). */
  readonly resize: (event: CalendarEvent, minutes: number) => void;
  /** The value a gesture would write — the start for a move, the end for a resize — for what is announced. */
  readonly landing: (event: CalendarEvent, gesture: ClockGesture & { resizing: boolean }) => string;
  readonly canCreate: boolean;
  /** Adds a note on a day, at a time when `minutes` is given. */
  readonly create: (args: { date: string; minutes: number | null; name: string }) => void;
  /** Told when a note is picked up and put down, so the calendar's keys leave its arrows alone. */
  readonly onHold: (holding: boolean) => void;
}

/** How far a note was dragged: whole days along, and minutes down the clock. */
export interface ClockGesture {
  readonly days: number;
  readonly minutes: number;
}

/**
 * A note's piece on one of its days. The piece on its first day is named by
 * its path alone, so focus follows it after a keyboard move; the others by
 * path and day.
 */
export function pieceId(event: CalendarEvent, date: string): string {
  return date === event.start.date ? event.path : `${event.path}@${date}`;
}

/** The note and the day a piece id names. */
export function pieceOf(
  id: string,
  byPath: ReadonlyMap<string, CalendarEvent>,
): { event: CalendarEvent; date: string } | null {
  const whole = byPath.get(id);
  if (whole !== undefined) return { event: whole, date: whole.start.date };
  const at = id.lastIndexOf('@');
  const event = at === -1 ? undefined : byPath.get(id.slice(0, at));
  return event === undefined ? null : { event, date: id.slice(at + 1) };
}
