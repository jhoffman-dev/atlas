import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * How far below the top of `scroller`'s content `element` sits, in layout
 * pixels. Read from offsets rather than client rects so that a transform — a
 * section sliding to its new place — does not move the answer while it plays,
 * and so that how far the scroller has scrolled does not count. The scroller
 * has to be positioned, so that the chain of offset parents reaches it; 0 when
 * it does not.
 */
export function offsetWithin(element: HTMLElement, scroller: HTMLElement): number {
  let offset = 0;
  for (let at: HTMLElement | null = element; at !== null;) {
    if (at === scroller) return offset;
    offset += at.offsetTop;
    const parent: Element | null = at.offsetParent;
    at = parent instanceof HTMLElement ? parent : null;
  }
  return 0;
}

/**
 * How much of the top of `scroller` its sticky headings cover: the scroller's
 * own `scroll-padding-top`, which the stylesheet sets to a heading's height so
 * that a row focused into view stops below one. Read from there rather than
 * repeated as a number, so the two cannot drift. 0 without a scroller.
 */
export function stickyOffsetOf(scroller: HTMLElement | null): number {
  if (scroller === null) return 0;
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  return Number.isFinite(padding) ? padding : 0;
}

/**
 * Where `content` starts inside the element that scrolls it, kept current as
 * what sits above it opens, shuts or moves. A virtualiser that shares its
 * scroller with other content needs this as its scroll margin, or it would
 * place and count its rows as if they started at the scroller's top.
 * 0 when there is no shared scroller.
 *
 * While the top of what is shown is inside `content`, a change above it
 * scrolls by as much, so the rows stay where they were under the pointer —
 * scroll anchoring, which WebKit does not do for us. Starring a row adds one to
 * Favorites above it, and the star clicked must not slide away.
 *
 * `anchors: false` leaves the scroll alone. Lists nested in a virtualiser
 * are anchored by it already — it scrolls by as much as a placed item above
 * the screen grows — and anchoring them again here moved the page back from a
 * scroll the browser had just made to show a focused row (#247).
 *
 * The scroller is passed as an element, not a ref: it is an ancestor of
 * `content`, and an ancestor's ref is attached only after its descendants'
 * layout effects have run, so a ref would still be empty on the first pass.
 * Or as a function that finds it from `content` — read in the layout effects,
 * where `content` is attached — so the page need not hold it as state, which
 * would cost a render of its own (#247). The function has to stay the same.
 *
 * Null until it is first measured, in the commit after the content mounts:
 * a virtualiser that took it for 0 meanwhile would think rows far down the
 * page sat above the screen, and scroll the page as it measured them.
 */
export function useScrollMargin(
  content: RefObject<HTMLElement | null>,
  scroller: HTMLElement | null | (() => HTMLElement | null),
  { anchors = true }: { readonly anchors?: boolean } = {},
): number | null {
  const [margin, setMargin] = useState<number | null>(null);
  /** Where content started when last measured; null before the first time. */
  const placed = useRef<number | null>(null);
  /**
   * How far the scroller was scrolled before a change: read on its scroll
   * events, since by the time a change is measured the browser may already
   * have clamped it to the shorter content.
   */
  const scrolled = useRef(0);

  const measure = (area: HTMLElement) => {
    const element = content.current;
    if (element === null) return;
    const next = offsetWithin(element, area);
    const before = placed.current;
    placed.current = next;
    if (anchors && before !== null && next !== before && scrolled.current > before) {
      area.scrollTop = scrolled.current + next - before;
      scrolled.current = area.scrollTop;
    }
    // Only when it moved: a resize or a scroll that moved nothing would
    // otherwise commit the page again for the same number (#247).
    if (next !== before) setMargin(next);
  };

  // Read once mounted, then only when something can have moved the content:
  // never on a render, since the sidebar renders on every commit of the app and
  // a read then forces the browser to lay the whole window out there and then
  // (#217). `measure` reads only refs and a state setter, so the first one serves.
  useLayoutEffect(() => {
    const area = typeof scroller === 'function' ? scroller() : scroller;
    if (area === null) return;
    scrolled.current = area.scrollTop;
    measure(area);
    const onScroll = () => {
      // Measured against where it was scrolled before this scroll: when the
      // scroll is the browser making room for what grew above, the room is
      // already made, and measuring from here would move the rows twice.
      measure(area);
      scrolled.current = area.scrollTop;
    };
    area.addEventListener('scroll', onScroll, { passive: true });
    return () => area.removeEventListener('scroll', onScroll);
  }, [content, scroller]);

  // A section above opening, shutting or growing changes the height of what
  // the scroller holds, and one moving changes the order of its sections
  // without changing a size: both are watched.
  useLayoutEffect(() => {
    const area = typeof scroller === 'function' ? scroller() : scroller;
    const inner = area?.firstElementChild ?? null;
    if (area === null || inner === null) return;
    const watchers: { disconnect: () => void }[] = [];
    if (typeof ResizeObserver !== 'undefined') {
      const resized = new ResizeObserver(() => measure(area));
      resized.observe(inner);
      watchers.push(resized);
    }
    if (typeof MutationObserver !== 'undefined') {
      const reordered = new MutationObserver(() => measure(area));
      reordered.observe(inner, { childList: true });
      watchers.push(reordered);
    }
    return () => {
      for (const watcher of watchers) watcher.disconnect();
    };
  }, [content, scroller]);

  return margin;
}
