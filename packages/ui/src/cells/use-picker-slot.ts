import { useEffect, useRef } from 'react';
import type { OverlaySlot } from '../overlay-slot.ts';
import { useSteadyCallback } from '../steady-callback.ts';

/**
 * A cell's picker under the app's one-overlay rule (#300): the slot is asked
 * for as a picker opens and given back as the edit ends — held, not given
 * back and asked again, while Tab moves from one picker to the next. Another
 * overlay taking the slot — ⌘K over the picker — ends the edit through
 * `dismiss`, and nothing is given back: the slot is no longer the table's.
 */
export function usePickerSlot({
  picking,
  slot,
  dismiss,
}: {
  /** Whether the cell being edited edits in a picker. */
  picking: boolean;
  slot: OverlaySlot | undefined;
  dismiss: () => void;
}): void {
  const ask = useSteadyCallback((open: boolean) => slot?.onOpenChange(open));
  const taken = useSteadyCallback(dismiss);
  const slotted = slot !== undefined;
  // Asked for and not given back; and whether the app has said it is up,
  // since only a slot once up can be taken away.
  const held = useRef({ asked: false, up: false });

  useEffect(() => {
    if (!slotted || picking === held.current.asked) return;
    held.current = { asked: picking, up: false };
    ask(picking);
  }, [slotted, picking, ask]);

  // The table gone from the page with a picker up — the view switched — gives the slot back.
  useEffect(
    () => () => {
      if (held.current.asked) ask(false);
    },
    [ask],
  );

  const open = slot?.open ?? false;
  useEffect(() => {
    if (!held.current.asked) return;
    if (open) {
      held.current = { asked: true, up: true };
    } else if (held.current.up) {
      held.current = { asked: false, up: false };
      taken();
    }
  }, [open, taken]);
}
