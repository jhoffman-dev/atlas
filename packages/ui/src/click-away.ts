import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onAway` when a press lands outside `inside` — the way a menu or a
 * popover that is not a modal dialog closes when the person moves on.
 */
export function useClickAway({
  inside,
  active,
  onAway,
}: {
  inside: RefObject<HTMLElement | null>;
  active: boolean;
  onAway: () => void;
}): void {
  const latest = useRef(onAway);
  useEffect(() => {
    latest.current = onAway;
  });
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = inside.current;
      if (element !== null && event.target instanceof Node && element.contains(event.target)) {
        return;
      }
      latest.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active, inside]);
}
