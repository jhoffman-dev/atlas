import { useEffect, type RefObject } from 'react';
import { useSteadyCallback } from '../steady-callback.ts';

/** Whether a cell is still drawn and still inside the sheet's visible area. */
export function anchorInView(anchor: HTMLElement | null, scroller: HTMLElement): boolean {
  if (anchor === null || !anchor.isConnected) return false;
  const cell = anchor.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  return cell.bottom > view.top && cell.top < view.bottom;
}

/**
 * A picker hangs from its cell; once the sheet scrolls the cell out of view
 * — or the virtualiser takes its row out of the page — there is nothing to
 * hang from, and a picker left up would float loose with its number keys
 * still writing a row nobody sees (#425). So it is closed, writing nothing.
 */
export function useAnchorWatch({
  picking,
  anchor,
  scroller,
  dismiss,
}: {
  picking: boolean;
  anchor: RefObject<HTMLElement | null>;
  scroller: HTMLElement | null;
  dismiss: () => void;
}): void {
  const leave = useSteadyCallback(dismiss);
  useEffect(() => {
    if (!picking || scroller === null) return;
    const check = () => {
      if (!anchorInView(anchor.current, scroller)) leave();
    };
    scroller.addEventListener('scroll', check, { passive: true });
    return () => scroller.removeEventListener('scroll', check);
  }, [picking, anchor, scroller, leave]);
}
