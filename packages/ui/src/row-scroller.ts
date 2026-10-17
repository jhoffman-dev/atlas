import { createContext, type RefObject } from 'react';

/**
 * The element a page scrolls its virtualised lists in (#238), as a ref the
 * lists read: while they render, for where the page is scrolled to, since a
 * list placed as the page scrolls would otherwise take it for the top and
 * scroll the page there (#247). Read through `scrollerOf`.
 */
export const RowScrollerContext = createContext<RefObject<HTMLElement | null>>({ current: null });

/** Marks the scroller, for a list in it to find in its first layout effects, before the ref is attached. */
const MARK = 'data-row-scroller';

/**
 * The page's scroller for a list whose rows start in `content`: by the ref
 * once it is attached, or by the mark from `content` in the list's first
 * layout effects, which run before an ancestor's ref is attached.
 */
export function scrollerOf(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): HTMLElement | null {
  return scroller.current ?? content.current?.closest<HTMLElement>(`[${MARK}]`) ?? null;
}

/** For a page's scrolling body, beside the ref it provides through `RowScrollerContext`. */
export const ROW_SCROLLER_MARK = { [MARK]: true } as const;
