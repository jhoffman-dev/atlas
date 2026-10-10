/**
 * Dragging a task from the planning tray onto the week's clock (P31-02).
 *
 * The clock has no drop targets of its own — a note on it lands by how far it
 * travelled (`clock-drag.ts`) — so a task from the tray lands by what is under
 * the pointer when it is let go: a block, which it joins, or a day's clock, at
 * the quarter hour the pointer is in. What is under the pointer is asked of
 * the page as it is then, so a clock scrolled during the drag is read where it
 * now is. The keyboard takes another way in (`ScheduleTray`): pick the task,
 * then press Enter on an hour or a block.
 */
import { useMemo, useRef, useState } from 'react';
import type { Announcements, DragEndEvent, DragMoveEvent, UniqueIdentifier } from '@dnd-kit/core';
import { dropSlot, slotValue, type TrayTask } from '@atlas/domain';
import { planWords, type PlanLanding } from './announcements.ts';
import { MINUTE_HEIGHT } from './clock-drag.ts';

const TRAY = 'tray:';

/** The drag id of a task in the tray. */
export const trayDragId = (task: TrayTask): string => `${TRAY}${task.path}`;

/** Whether a drag is of a task from the tray, rather than of a note on the clock. */
export const isTrayDrag = (id: UniqueIdentifier): boolean => String(id).startsWith(TRAY);

/** Where on the calendar a task from the tray lands. */
export type PlanTarget =
  /** Empty time on a day's clock: `minutes` after midnight, on the quarter hour. */
  | { readonly kind: 'time'; readonly date: string; readonly minutes: number }
  /** A block that is already there. */
  | { readonly kind: 'block'; readonly block: string; readonly title: string };

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where the pointer is: where it was pressed, plus how far it has travelled since. */
function pointerOf({
  activatorEvent,
  delta,
}: Pick<DragMoveEvent, 'activatorEvent' | 'delta'>): Point | null {
  if (!(activatorEvent instanceof MouseEvent)) return null;
  return { x: activatorEvent.clientX + delta.x, y: activatorEvent.clientY + delta.y };
}

type ElementsAt = (x: number, y: number) => readonly Element[];

const pageElementsAt: ElementsAt = (x, y) => document.elementsFromPoint(x, y);

/**
 * What is under `point` on the calendar: the block there, or the day's clock
 * at the quarter hour the point is in; null over anything else. A block is
 * above its day in the page, so it is found first.
 */
export function planTargetAt(
  point: Point,
  elementsAt: ElementsAt = pageElementsAt,
): PlanTarget | null {
  for (const element of elementsAt(point.x, point.y)) {
    const block = element.closest<HTMLElement>('.clock__note[data-path]');
    if (block !== null) {
      return {
        kind: 'block',
        block: block.dataset['path'] ?? '',
        title: block.querySelector('.clock__note-title')?.textContent ?? '',
      };
    }
    const day = element.closest<HTMLElement>('.clock__column[data-date]');
    if (day !== null) {
      const minutes = (point.y - day.getBoundingClientRect().top) / MINUTE_HEIGHT;
      return { kind: 'time', date: day.dataset['date'] ?? '', minutes: dropSlot(minutes) };
    }
  }
  return null;
}

/** A target in the words a screen reader hears. */
export function landingOf(target: PlanTarget | null): PlanLanding {
  if (target === null) return null;
  return target.kind === 'time'
    ? { kind: 'time', value: slotValue(target.date, target.minutes) }
    : { kind: 'block', title: target.title };
}

/**
 * The tray's side of the calendar's drag: which task is held, where it would
 * land, and — let go over the calendar — `onPlace` with where.
 */
export function useTrayDrag({
  tasks,
  onPlace,
  elementsAt = pageElementsAt,
}: {
  tasks: readonly TrayTask[];
  onPlace: (task: TrayTask, target: PlanTarget) => void;
  elementsAt?: ElementsAt;
}) {
  const byId = useMemo(() => new Map(tasks.map((task) => [trayDragId(task), task])), [tasks]);
  const [held, setHeld] = useState<TrayTask | null>(null);
  // A ref, not state: the announcement for a move is asked for straight after the move.
  const landing = useRef<PlanTarget | null>(null);

  const targetOf = (event: Pick<DragMoveEvent, 'activatorEvent' | 'delta'>) => {
    const point = pointerOf(event);
    return point === null ? null : planTargetAt(point, elementsAt);
  };

  const announcements = useMemo<Announcements>(() => {
    const title = (id: UniqueIdentifier) => byId.get(String(id))?.title ?? String(id);
    return {
      onDragStart: ({ active }) => planWords.start(title(active.id)),
      onDragMove: ({ active }) => planWords.over(title(active.id), landingOf(landing.current)),
      // Nothing on the clock is a drop target; the move says where the task is.
      onDragOver: () => undefined,
      onDragEnd: ({ active }) => planWords.end(title(active.id), landingOf(landing.current)),
      onDragCancel: ({ active }) => planWords.cancel(title(active.id)),
    };
  }, [byId]);

  return {
    held,
    announcements,
    onDragStart: (id: UniqueIdentifier) => {
      landing.current = null;
      setHeld(byId.get(String(id)) ?? null);
    },
    onDragMove: (event: DragMoveEvent) => {
      landing.current = targetOf(event);
    },
    onDragEnd: (event: DragEndEvent) => {
      const task = byId.get(String(event.active.id));
      landing.current = targetOf(event);
      setHeld(null);
      if (task !== undefined && landing.current !== null) onPlace(task, landing.current);
    },
    onDragCancel: () => {
      landing.current = null;
      setHeld(null);
    },
  };
}

/**
 * The calendar's announcements: the tray's while one of its tasks is held,
 * the clock's otherwise.
 */
export function routedAnnouncements(tray: Announcements, clock: Announcements): Announcements {
  const of = (id: UniqueIdentifier) => (isTrayDrag(id) ? tray : clock);
  return {
    onDragStart: (event) => of(event.active.id).onDragStart(event),
    onDragMove: (event) => of(event.active.id).onDragMove?.(event),
    onDragOver: (event) => of(event.active.id).onDragOver(event),
    onDragEnd: (event) => of(event.active.id).onDragEnd(event),
    onDragCancel: (event) => of(event.active.id).onDragCancel(event),
  };
}
