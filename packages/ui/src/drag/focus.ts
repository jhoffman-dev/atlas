/**
 * Focus that follows an item to where a keyboard drag put it.
 *
 * A dropped card is not moved in place: the drop writes the file, the view is
 * queried again, and the card is drawn afresh in its new column or day. dnd-kit
 * gives focus back to the element it picked up — which is the old one, about to
 * be removed — so without this, focus falls to the page and a keyboard user
 * starts again from the top after every move.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';

export interface FocusFollower {
  /** Note that the item dropped by this event should take focus when it is drawn anew. */
  follow: (event: DragEndEvent) => void;
  /** True, once, for the item waiting to take focus. */
  claim: (id: string) => boolean;
}

export function useFocusFollower(): FocusFollower {
  const waiting = useRef<string | null>(null);
  // Only a keyboard drop moves focus: a pointer user's focus is wherever they
  // left it, and yanking it would be a surprise.
  const follow = useCallback(({ active, activatorEvent }: DragEndEvent) => {
    waiting.current = activatorEvent instanceof KeyboardEvent ? String(active.id) : null;
  }, []);
  const claim = useCallback((id: string) => {
    if (waiting.current !== id) return false;
    waiting.current = null;
    return true;
  }, []);
  return { follow, claim };
}

/**
 * Focuses the element when it is first drawn, if it is the one waiting for
 * focus. Only on mount: the copy still standing in the old place was drawn
 * before the drop, so it never claims it.
 *
 * Returns a ref callback, which also hands the element to `alsoRef` — the
 * handle is dnd-kit's activator as well, and an element has one `ref`.
 */
export function useClaimFocus<T extends HTMLElement>({
  claim,
  id,
  alsoRef,
}: {
  claim: FocusFollower['claim'];
  id: string;
  alsoRef: (element: T | null) => void;
}) {
  const element = useRef<T | null>(null);
  useEffect(() => {
    if (claim(id)) element.current?.focus();
  }, [claim, id]);
  return useCallback(
    (node: T | null) => {
      element.current = node;
      alsoRef(node);
    },
    [alsoRef],
  );
}
