/**
 * Arranging a dashboard, pointer or keyboard: moving a widget to another place
 * in the grid, and dragging its right edge to change how many columns it spans.
 *
 * A held widget is not dragged across the grid. It is drawn where it would land
 * — the others close up around it — so what the grid shows mid-drag is what
 * the file will say. The pointer drags a ghost; the keyboard steps a place or a
 * column at a time. Where it lands and how wide it is are the domain's rules
 * (`stepPlacement`, `spanAfterDrag`); this is the glue that feeds them events.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Announcements,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { moveItem, spanAfterDrag, stepPlacement, type Placement, type Widget } from '@atlas/domain';
import type { WidgetResult } from '@atlas/application';
import { dashboardWords, type WidgetSpot } from './announcements.ts';
import { useDragSensors } from './dnd.ts';
import { dashboardStep, directionOf } from './snapping.ts';

/** How a widget was picked up: by its handle with the pointer or the keys, or by its edge. */
type Grip = 'pointer' | 'keyboard' | 'resize';

interface Held {
  readonly id: string;
  /** Where it was on the grid when it was picked up. */
  readonly from: number;
  readonly grip: Grip;
  readonly placement: Placement;
  /** One column and its gap, in pixels, for a resize by pointer. */
  readonly column: number;
}

const MOVE = 'move:';
const SIZE = 'size:';
export const moveHandleId = (widget: Widget) => `${MOVE}${widget.id}`;
export const sizeHandleId = (widget: Widget) => `${SIZE}${widget.id}`;

export interface WidgetPlacement {
  readonly widget: Widget;
  /** The `widgets:` entry it goes to the place of. */
  readonly to: number;
  /** Its new width, or null when the gesture left it as wide as it was. */
  readonly span: number | null;
}

/** The results in the order and at the widths the grid should draw them. */
function arrange(results: readonly WidgetResult[], held: Held | null): readonly WidgetResult[] {
  if (held === null) return results;
  return moveItem(results, held.from, held.placement.index).map((result) =>
    result.widget.id === held.id
      ? { ...result, widget: { ...result.widget, span: held.placement.span } }
      : result,
  );
}

export function useWidgetDrag({
  results,
  onPlace,
  measureColumn,
  failed,
}: {
  results: readonly WidgetResult[];
  onPlace: (placement: WidgetPlacement) => void;
  /** The width of one grid column and its gap, measured when a resize starts. */
  measureColumn: () => number;
  /** The last write did not happen, so a drop waiting on it never will be read back. */
  failed: boolean;
}) {
  const [held, setHeld] = useState<Held | null>(null);
  // Dropped but not yet read back from the file: drawn where it landed until
  // the dashboard's results change, so the grid does not jump back and forth.
  const [landed, setLanded] = useState<{ held: Held; against: readonly WidgetResult[] } | null>(
    null,
  );
  // Refs as well as state: dnd-kit asks for an announcement straight after the
  // event it reports, before a render, and the keyboard steps from its own
  // listener.
  const heldNow = useRef<Held | null>(null);
  const lastHeld = useRef<Held | null>(null);
  const latest = useRef(results);
  useEffect(() => {
    latest.current = results;
  });

  const hold = useCallback((next: Held | null) => {
    if (next !== null) lastHeld.current = next;
    heldNow.current = next;
    setHeld(next);
  }, []);

  const waiting = landed?.against === results && !failed ? landed.held : null;
  const shown = held ?? waiting;
  const arranged = useMemo(() => arrange(results, shown), [results, shown]);

  const byStep = useMemo<KeyboardCoordinateGetter>(
    () =>
      (event, { currentCoordinates }) => {
        const direction = directionOf(event.code);
        const current = heldNow.current;
        if (direction === null || current === null) return undefined;
        // An arrow key while holding a widget must never scroll the page instead.
        event.preventDefault();
        const step = dashboardStep(direction, event.shiftKey);
        if (step === null) return undefined;
        const count = latest.current.length;
        hold({ ...current, placement: stepPlacement(current.placement, { step, count }) });
        // The widget is redrawn at its new place, not dragged there, but dnd-kit
        // reports a move — and says it — only when the held item's coordinates
        // change. A pixel each press is enough, and nothing is drawn from it.
        const nudge = direction === 'left' || direction === 'up' ? -1 : 1;
        return { x: currentCoordinates.x + nudge, y: currentCoordinates.y };
      },
    [hold],
  );
  const sensors = useDragSensors(byStep);

  const refocus = useRefocus(results);
  const handlers = useDragHandlers({
    hold,
    heldNow,
    latest,
    measureColumn,
    onPlace,
    setLanded,
    refocusOn: refocus.after,
  });
  const announcements = useAnnouncements({ heldNow, lastHeld, latest });

  return {
    sensors,
    announcements,
    ...handlers,
    arranged,
    /** The widget in hand, and how it was picked up; null once it is let go. */
    held,
    /**
     * A drop is still being written. Nothing can be picked up until the grid is
     * redrawn from the file: that redraw replaces every widget that moved, and
     * one picked up now would vanish from under its own drag.
     */
    settling: held === null && waiting !== null,
    handleRef: refocus.handleRef,
  };
}

/**
 * Focus that follows a widget moved with the keys. Its move is written to the
 * file and the grid is drawn afresh from it, so the handle that was focused is
 * gone; the one drawn for the entry the widget moved to takes the focus, and
 * the next arrow carries on from there.
 */
function useRefocus(results: readonly WidgetResult[]) {
  const handles = useRef(new Map<number, HTMLElement>());
  const waiting = useRef<number | null>(null);
  useEffect(() => {
    const entry = waiting.current;
    const handle = entry === null ? undefined : handles.current.get(entry);
    if (handle === undefined) return;
    waiting.current = null;
    handle.focus();
  }, [results]);
  const handleRef = useCallback(
    (entry: number) => (element: HTMLElement | null) => {
      if (element === null) handles.current.delete(entry);
      else handles.current.set(entry, element);
    },
    [],
  );
  const after = useCallback((entry: number) => {
    waiting.current = entry;
  }, []);
  return { handleRef, after };
}

function useDragHandlers({
  hold,
  heldNow,
  latest,
  measureColumn,
  onPlace,
  setLanded,
  refocusOn,
}: {
  hold: (next: Held | null) => void;
  heldNow: { readonly current: Held | null };
  latest: { readonly current: readonly WidgetResult[] };
  measureColumn: () => number;
  onPlace: (placement: WidgetPlacement) => void;
  setLanded: (landed: { held: Held; against: readonly WidgetResult[] }) => void;
  /** Only a keyboard drop moves the focus: a pointer user's is wherever they left it. */
  refocusOn: (entry: number) => void;
}) {
  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const handle = String(active.id);
    const resizing = handle.startsWith(SIZE);
    const id = handle.slice(resizing ? SIZE.length : MOVE.length);
    const from = latest.current.findIndex((result) => result.widget.id === id);
    const widget = latest.current[from]?.widget;
    if (widget === undefined) return;
    const grip: Grip = resizing
      ? 'resize'
      : activatorEvent instanceof KeyboardEvent
        ? 'keyboard'
        : 'pointer';
    hold({
      id,
      from,
      grip,
      placement: { index: from, span: widget.span },
      column: resizing ? measureColumn() : 0,
    });
  };

  const onDragMove = ({ delta }: DragMoveEvent) => {
    const current = heldNow.current;
    const widget = current === null ? undefined : latest.current[current.from]?.widget;
    if (current?.grip !== 'resize' || widget === undefined) return;
    const span = spanAfterDrag({ span: widget.span, deltaX: delta.x, column: current.column });
    if (span !== current.placement.span)
      hold({ ...current, placement: { ...current.placement, span } });
  };

  // The pointer puts the held widget in the place of whichever one it is over.
  // Only a change of target moves it, so a widget that shifts under a still
  // pointer does not bounce back.
  const onDragOver = ({ over }: DragOverEvent) => {
    const current = heldNow.current;
    if (current?.grip !== 'pointer' || over === null || String(over.id) === current.id) return;
    const index = arrange(latest.current, current).findIndex(
      (result) => result.widget.id === String(over.id),
    );
    if (index !== -1) hold({ ...current, placement: { ...current.placement, index } });
  };

  const onDragEnd = () => {
    const done = heldNow.current;
    hold(null);
    const widget = done === null ? undefined : latest.current[done.from]?.widget;
    const target = done === null ? undefined : latest.current[done.placement.index]?.widget;
    if (done === null || widget === undefined || target === undefined) return;
    const resized = done.placement.span !== widget.span;
    if (done.placement.index === done.from && !resized) return;
    setLanded({ held: done, against: latest.current });
    if (done.grip === 'keyboard') refocusOn(target.entry);
    onPlace({ widget, to: target.entry, span: resized ? done.placement.span : null });
  };

  const onDragCancel = () => hold(null);

  return { onDragStart, onDragMove, onDragOver, onDragEnd, onDragCancel };
}

function useAnnouncements({
  heldNow,
  lastHeld,
  latest,
}: {
  heldNow: { readonly current: Held | null };
  lastHeld: { readonly current: Held | null };
  latest: { readonly current: readonly WidgetResult[] };
}): Announcements {
  return useMemo<Announcements>(() => {
    const spotOf = (held: Held | null, at: 'now' | 'start' = 'now'): WidgetSpot | null => {
      const widget = held === null ? undefined : latest.current[held.from]?.widget;
      if (held === null || widget === undefined) return null;
      const place = at === 'start' ? { index: held.from, span: widget.span } : held.placement;
      return {
        title: widget.title,
        position: place.index + 1,
        count: latest.current.length,
        span: place.span,
      };
    };
    const said = (words: (spot: WidgetSpot) => string, spot: WidgetSpot | null) =>
      spot === null ? undefined : words(spot);
    return {
      onDragStart: () => said(dashboardWords.start, spotOf(heldNow.current)),
      // A pointer moving a widget is heard by what it is over; the keys and a
      // resize are heard on every step.
      onDragMove: () =>
        heldNow.current?.grip === 'pointer'
          ? undefined
          : said(dashboardWords.move, spotOf(heldNow.current)),
      onDragOver: () =>
        heldNow.current?.grip === 'pointer'
          ? said(dashboardWords.move, spotOf(heldNow.current))
          : undefined,
      onDragEnd: () => {
        const held = lastHeld.current;
        const moved =
          held !== null &&
          (held.placement.index !== held.from ||
            held.placement.span !== latest.current[held.from]?.widget.span);
        return said((spot) => dashboardWords.end(spot, moved), spotOf(held));
      },
      onDragCancel: () => said(dashboardWords.cancel, spotOf(lastHeld.current, 'start')),
    };
  }, [heldNow, lastHeld, latest]);
}
