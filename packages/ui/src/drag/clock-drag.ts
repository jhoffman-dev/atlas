/**
 * Dragging a note across a week's clock, pointer or keyboard.
 *
 * Like a timeline bar, a note on the clock lands wherever it is let go, so the
 * drop is worked out from how far it travelled: whole columns along are days,
 * and the distance down is minutes, landed on the quarter hour. Left and Right
 * move a held note a day, Up and Down a quarter of an hour. An all-day note
 * moves by days only; a note's end handle, by minutes only.
 */
import { useMemo, useRef } from 'react';
import type {
  Active,
  Announcements,
  DragEndEvent,
  DragMoveEvent,
  KeyboardCoordinateGetter,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { snappedMove, SNAP_MINUTES, type CalendarEvent } from '@atlas/domain';
import { pieceOf, type CalendarGestures, type ClockGesture } from '../calendar-gestures.ts';
import { clockWords, type ClockMove } from './announcements.ts';
import { useDragSensors } from './dnd.ts';
import { directionOf } from './snapping.ts';

/** How tall an hour is drawn. The clock's scale is the view's business, not the rules'. */
export const HOUR_HEIGHT = 48;
export const MINUTE_HEIGHT = HOUR_HEIGHT / 60;
const SLOT_HEIGHT = SNAP_MINUTES * MINUTE_HEIGHT;

const END_HANDLE = '#end';

/** The drag id of a note's end handle. */
export function endHandleId(event: CalendarEvent): string {
  return `${event.path}${END_HANDLE}`;
}

interface Held {
  readonly event: CalendarEvent;
  readonly resizing: boolean;
}

function heldBy(id: UniqueIdentifier, byPath: ReadonlyMap<string, CalendarEvent>): Held | null {
  const name = String(id);
  if (name.endsWith(END_HANDLE)) {
    const event = byPath.get(name.slice(0, -END_HANDLE.length));
    return event === undefined ? null : { event, resizing: true };
  }
  const piece = pieceOf(name, byPath);
  return piece === null ? null : { event: piece.event, resizing: false };
}

/** Which way a held thing can go: an all-day note only along, an end handle only down. */
function stepFor(held: Held | null, code: string, dayWidth: number): { x: number; y: number } {
  const direction = directionOf(code);
  const along = held?.resizing !== true;
  const down = held !== null && (held.resizing || held.event.start.minutes !== null);
  if (direction === 'left' && along) return { x: -dayWidth, y: 0 };
  if (direction === 'right' && along) return { x: dayWidth, y: 0 };
  if (direction === 'up' && down) return { x: 0, y: -SLOT_HEIGHT };
  if (direction === 'down' && down) return { x: 0, y: SLOT_HEIGHT };
  return { x: 0, y: 0 };
}

/** What the travel means: whole days along, and minutes down on the quarter hour. */
function gestureOf(held: Held, delta: { x: number; y: number }, dayWidth: number): ClockGesture {
  const days = held.resizing || dayWidth <= 0 ? 0 : Math.round(delta.x / dayWidth);
  const travelled = delta.y / MINUTE_HEIGHT;
  if (held.resizing)
    return { days: 0, minutes: Math.round(travelled / SNAP_MINUTES) * SNAP_MINUTES };
  const start = held.event.start.minutes;
  return { days, minutes: start === null ? 0 : snappedMove(start, travelled) };
}

export function useClockDrag({
  events,
  gestures,
  dayWidth,
}: {
  events: readonly CalendarEvent[];
  gestures: CalendarGestures;
  /** How wide a day's column is now, measured when it is needed. */
  dayWidth: () => number;
}) {
  const byPath = useMemo(() => new Map(events.map((event) => [event.path, event])), [events]);
  // Refs, not state: dnd-kit calls these from its own events, and the
  // announcement for a move is asked for straight after the move is reported.
  const landing = useRef<ClockMove | null>(null);

  const snap = useMemo<KeyboardCoordinateGetter>(
    () =>
      (event, { context, currentCoordinates }) => {
        if (directionOf(event.code) === null) return undefined;
        // An arrow key while holding a note must never scroll the clock instead.
        event.preventDefault();
        const held = context.active === null ? null : heldBy(context.active.id, byPath);
        const step = stepFor(held, event.code, dayWidth());
        if (step.x === 0 && step.y === 0) return undefined;
        return { x: currentCoordinates.x + step.x, y: currentCoordinates.y + step.y };
      },
    [byPath, dayWidth],
  );
  const sensors = useDragSensors(snap);

  const moveOf = (active: Active, delta: { x: number; y: number }) => {
    const held = heldBy(active.id, byPath);
    if (held === null) return null;
    const gesture = gestureOf(held, delta, dayWidth());
    const moved = gesture.days !== 0 || gesture.minutes !== 0;
    const value = gestures.landing(held.event, { ...gesture, resizing: held.resizing });
    return {
      held,
      gesture,
      words: { title: held.event.title, moved, value, resizing: held.resizing },
    };
  };

  const onDragMove = ({ active, delta }: DragMoveEvent) => {
    landing.current = moveOf(active, delta)?.words ?? null;
  };

  const onDragEnd = ({ active, delta }: DragEndEvent) => {
    gestures.onHold(false);
    const move = moveOf(active, delta);
    landing.current = move?.words ?? null;
    if (move === null || !move.words.moved) return;
    if (move.held.resizing) gestures.resize(move.held.event, move.gesture.minutes);
    else gestures.move(move.held.event, move.gesture);
  };

  const announcements = useMemo<Announcements>(() => {
    const title = (id: UniqueIdentifier) => heldBy(id, byPath)?.event.title ?? String(id);
    return {
      onDragStart: ({ active }) => {
        const held = heldBy(active.id, byPath);
        if (held === null) return undefined;
        const value = gestures.landing(held.event, {
          days: 0,
          minutes: 0,
          resizing: held.resizing,
        });
        return clockWords.start(held.event.title, value);
      },
      onDragMove: () => (landing.current === null ? undefined : clockWords.move(landing.current)),
      // Nothing on the clock is a drop target; the move says where the note is.
      onDragOver: () => undefined,
      onDragEnd: () => (landing.current === null ? undefined : clockWords.end(landing.current)),
      onDragCancel: ({ active }) => clockWords.cancel(title(active.id)),
    };
  }, [byPath, gestures]);

  return {
    sensors,
    announcements,
    onDragStart: () => {
      landing.current = null;
      gestures.onHold(true);
    },
    onDragMove,
    onDragEnd,
    onDragCancel: () => gestures.onHold(false),
  };
}
