/**
 * Dragging a timeline bar through time, pointer or keyboard.
 *
 * A timeline has no drop targets: a bar lands wherever along its row it is let
 * go, so the drop is worked out from how far it travelled rather than from
 * what it is over. Left and Right move a held bar a day; a bar never leaves its
 * row, whatever the pointer does vertically.
 */
import { useMemo, useRef } from 'react';
import type {
  Active,
  Announcements,
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
  Modifier,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { addDays, type TimelineEntry } from '@atlas/domain';
import { timelineWords, type BarMove } from './announcements.ts';
import { useDragSensors } from './dnd.ts';
import { daysMoved, directionOf, grabOffset, timelineStep } from './snapping.ts';

/** A bar moves in time only: it stays on its own row. */
export const alongItsRow: Modifier = ({ transform }) => ({ ...transform, y: 0 });

function byTheDay(dayWidth: number): KeyboardCoordinateGetter {
  return (event, { currentCoordinates }) => {
    const direction = directionOf(event.code);
    if (direction === null) return undefined;
    // An arrow key while holding a bar must never scroll the page instead.
    event.preventDefault();
    const step = timelineStep(direction, dayWidth);
    return step === 0 ? undefined : { ...currentCoordinates, x: currentCoordinates.x + step };
  };
}

export function useBarDrag({
  entries,
  dayWidth,
  onReschedule,
}: {
  entries: readonly TimelineEntry[];
  dayWidth: number;
  onReschedule: (args: { path: string; start: string; end: string }) => void;
}) {
  const snap = useMemo(() => byTheDay(dayWidth), [dayWidth]);
  const sensors = useDragSensors(snap);
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  // Refs, not state: dnd-kit calls these from its own events, and the
  // announcement for a move is asked for straight after the move is reported.
  const pressedAt = useRef<number | null>(null);
  const landing = useRef<BarMove | null>(null);

  // The bar's box is measured by dnd-kit just after the drag starts, so the
  // grab offset is worked out when a move or drop is, not at pick-up.
  const moveOf = (active: Active, deltaX: number): BarMove | null => {
    const entry = byPath.get(String(active.id));
    if (entry === undefined) return null;
    const grab = grabOffset({
      clientX: pressedAt.current,
      barLeft: active.rect.current.initial?.left ?? 0,
      offset: entry.offset,
      dayWidth,
    });
    const moved = daysMoved({ grabOffset: grab, deltaX, dayWidth });
    const start = addDays(entry.start, moved);
    const end = addDays(entry.end, moved);
    // There is no date past 9999-12-31 to write. Moving the other end anyway
    // would change the bar's length, so the bar does not move at all.
    return start === null || end === null
      ? { title: entry.title, moved: 0, start: entry.start, end: entry.end }
      : { title: entry.title, moved, start, end };
  };

  const onDragStart = ({ activatorEvent }: DragStartEvent) => {
    pressedAt.current = activatorEvent instanceof MouseEvent ? activatorEvent.clientX : null;
    landing.current = null;
  };

  const onDragMove = ({ active, delta }: DragMoveEvent) => {
    landing.current = moveOf(active, delta.x);
  };

  const onDragEnd = ({ active, delta }: DragEndEvent) => {
    const move = moveOf(active, delta.x);
    landing.current = move;
    if (move === null || move.moved === 0) return;
    // Both ends in one call: moveBar writes them as one edit.
    onReschedule({ path: String(active.id), start: move.start, end: move.end });
  };

  const announcements = useMemo<Announcements>(() => {
    const said = (id: UniqueIdentifier, words: (entry: TimelineEntry) => string) => {
      const entry = byPath.get(String(id));
      return entry === undefined ? undefined : words(entry);
    };
    return {
      onDragStart: ({ active }) =>
        said(active.id, (entry) => timelineWords.start(entry.title, entry.start, entry.end)),
      onDragMove: () =>
        landing.current === null ? undefined : timelineWords.move(landing.current),
      // There is nothing to be over on a timeline; the move says where it is.
      onDragOver: () => undefined,
      onDragEnd: () => (landing.current === null ? undefined : timelineWords.end(landing.current)),
      onDragCancel: ({ active }) =>
        said(active.id, (entry) => timelineWords.cancel(entry.title, entry.start, entry.end)),
    };
  }, [byPath]);

  return { sensors, announcements, onDragStart, onDragMove, onDragEnd };
}
