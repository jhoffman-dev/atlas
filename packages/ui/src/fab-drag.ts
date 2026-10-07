import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { FabAnchor } from '@atlas/domain';
import {
  fabAnchorPoint,
  isFabDrag,
  nearestFabAnchor,
  FAB_SIZE,
  type FabArea,
  type FabPoint,
} from './fab-geometry.ts';

interface Press {
  readonly start: FabPoint;
  /** Where on the button it was grabbed, so it does not jump to centre under the pointer. */
  readonly grab: FabPoint;
  /** The layer's corner on screen, taken once: nothing moves it mid-drag. */
  readonly origin: FabPoint;
  dragging: boolean;
  // Kept here as well as in state: the release can arrive before a render.
  near: FabAnchor | null;
}

/** The add button while it is being dragged. */
export interface FabDrag {
  /** Where its corner is under the pointer, in the layer's pixels; null when it is not being dragged. */
  readonly point: FabPoint | null;
  /** The anchor it would snap to if let go now. */
  readonly near: FabAnchor | null;
  readonly handlers: {
    readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: () => void;
  };
  /** True, once, for the click a drag ends with — which is not a click. */
  readonly endedDrag: () => boolean;
}

/**
 * Dragging the add button. A press only becomes a drag past its threshold, so a click that wobbles is still a click; let go, it snaps to
 * the nearest anchor, which is the domain's to find.
 */
export function useFabDrag({
  anchor,
  area,
  layer,
  onMove,
}: {
  anchor: FabAnchor;
  area: FabArea;
  layer: RefObject<HTMLElement | null>;
  onMove: (anchor: FabAnchor) => void;
}): FabDrag {
  const press = useRef<Press | null>(null);
  const justDragged = useRef(false);
  const [point, setPoint] = useState<FabPoint | null>(null);
  const [near, setNear] = useState<FabAnchor | null>(null);

  const finish = () => {
    press.current = null;
    setPoint(null);
    setNear(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const rect = layer.current?.getBoundingClientRect();
    const origin = { x: rect?.left ?? 0, y: rect?.top ?? 0 };
    const corner = fabAnchorPoint({ anchor, area });
    press.current = {
      start: { x: event.clientX, y: event.clientY },
      grab: { x: event.clientX - origin.x - corner.x, y: event.clientY - origin.y - corner.y },
      origin,
      dragging: false,
      near: null,
    };
    justDragged.current = false;
    // Not every environment captures (jsdom does not); the drag then ends where the pointer leaves.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = press.current;
    if (current === null) return;
    const to = { x: event.clientX, y: event.clientY };
    if (!current.dragging && !isFabDrag({ from: current.start, to })) return;
    current.dragging = true;
    const corner = {
      x: to.x - current.origin.x - current.grab.x,
      y: to.y - current.origin.y - current.grab.y,
    };
    current.near = nearestFabAnchor({
      centre: { x: corner.x + FAB_SIZE / 2, y: corner.y + FAB_SIZE / 2 },
      area,
    });
    setPoint(corner);
    setNear(current.near);
  };

  const onPointerUp = () => {
    const current = press.current;
    if (current?.dragging === true && current.near !== null) {
      justDragged.current = true;
      onMove(current.near);
    }
    finish();
  };

  return {
    point,
    near,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: finish },
    endedDrag: () => {
      const ended = justDragged.current;
      justDragged.current = false;
      return ended;
    },
  };
}
