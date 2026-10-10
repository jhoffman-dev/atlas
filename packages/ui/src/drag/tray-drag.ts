/**
 * Dragging a task from the planning tray onto the week's clock (P31-02).
 *
 * The clock has no drop targets of its own — a note on it lands by how far it
 * travelled (`clock-drag.ts`) — so a task from the tray lands by what is under
 * the pointer when it is let go: a block, which it joins, or a day's clock, at
 * the quarter hour the pointer is in. What is under the pointer is asked of
 * the page as it is then, so a clock scrolled during the drag is read where it
 * now is — and only of this calendar's own clock, so a drop over another
 * pane's calendar plans nothing here. The keyboard takes another way in
 * (`ScheduleTray`): pick the task, then press Enter on an hour or a block.
 *
 * Where the pointer is, is followed from its own moves. dnd-kit's travel is no
 * measure of it: the tray's list scrolls, and dnd-kit counts a scroll of the
 * list under a held task as travel, which would land the task hours away.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Announcements, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
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

/**
 * The pointer, followed from where it was pressed through each of its moves
 * until `stop`. Heard on the window as a move starts down, before anything
 * on the page can act on it.
 */
function followPointer(pressed: Event): { at: () => Point | null; stop: () => void } {
  let at: Point | null =
    pressed instanceof MouseEvent ? { x: pressed.clientX, y: pressed.clientY } : null;
  const moved = (event: PointerEvent) => {
    at = { x: event.clientX, y: event.clientY };
  };
  window.addEventListener('pointermove', moved, { capture: true });
  return {
    at: () => at,
    stop: () => window.removeEventListener('pointermove', moved, { capture: true }),
  };
}

type ElementsAt = (x: number, y: number) => readonly Element[];

const pageElementsAt: ElementsAt = (x, y) => document.elementsFromPoint(x, y);

/**
 * What is under `point` on the calendar inside `within`: the block there, or
 * the day's clock at the quarter hour the point is in; null over anything
 * else, another calendar's clock included. A block is above its day in the
 * page, so it is found first.
 */
export function planTargetAt(
  point: Point,
  { within, elementsAt = pageElementsAt }: { within: Element | null; elementsAt?: ElementsAt },
): PlanTarget | null {
  if (within === null) return null;
  for (const element of elementsAt(point.x, point.y)) {
    if (!within.contains(element)) continue;
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
  within,
  elementsAt = pageElementsAt,
}: {
  tasks: readonly TrayTask[];
  onPlace: (task: TrayTask, target: PlanTarget) => void;
  /** This calendar's clock, read when the target is asked for. */
  within: () => Element | null;
  elementsAt?: ElementsAt;
}) {
  const byId = useMemo(() => new Map(tasks.map((task) => [trayDragId(task), task])), [tasks]);
  const [held, setHeld] = useState<TrayTask | null>(null);
  // Refs, not state: the announcement for a move is asked for straight after the move.
  const landing = useRef<PlanTarget | null>(null);
  const pointer = useRef<ReturnType<typeof followPointer> | null>(null);
  const letGo = () => {
    pointer.current?.stop();
    pointer.current = null;
  };
  // A drag cut short by the calendar going away stops following the pointer too.
  useEffect(() => letGo, []);

  const target = () => {
    const point = pointer.current?.at() ?? null;
    return point === null ? null : planTargetAt(point, { within: within(), elementsAt });
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
    onDragStart: ({ active, activatorEvent }: DragStartEvent) => {
      letGo();
      pointer.current = followPointer(activatorEvent);
      landing.current = null;
      setHeld(byId.get(String(active.id)) ?? null);
    },
    onDragMove: () => {
      landing.current = target();
    },
    onDragEnd: ({ active }: { active: { id: UniqueIdentifier } }) => {
      const task = byId.get(String(active.id));
      landing.current = target();
      letGo();
      setHeld(null);
      if (task !== undefined && landing.current !== null) onPlace(task, landing.current);
    },
    onDragCancel: () => {
      letGo();
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
