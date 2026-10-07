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
 * The scroller is passed as an element, not a ref: it is an ancestor of
 * `content`, and an ancestor's ref is attached only after its descendants'
 * layout effects have run, so a ref would still be empty on the first pass.
 */
export function useScrollMargin(
  content: RefObject<HTMLElement | null>,
  scroller: HTMLElement | null,
): number {
  const [margin, setMargin] = useState(0);
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
    if (before !== null && next !== before && scrolled.current > before) {
      area.scrollTop = scrolled.current + next - before;
      scrolled.current = area.scrollTop;
    }
    setMargin(next);
  };

  // Every render: a section above opening, shutting or moving re-renders the
  // sidebar and this with it, so there is no value to depend on — only the
  // layout. Setting the same number again does not render again.
  useLayoutEffect(() => {
    if (scroller !== null) measure(scroller);
  });

  useLayoutEffect(() => {
    if (scroller === null) return;
    scrolled.current = scroller.scrollTop;
    const onScroll = () => {
      scrolled.current = scroller.scrollTop;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller]);

  // What the sidebar does not re-render for — a row above that wraps once a
  // font arrives — still changes the content's height, so that is watched too.
  // `measure` reads only refs and a state setter, so the first one serves.
  useLayoutEffect(() => {
    const inner = scroller?.firstElementChild ?? null;
    if (scroller === null || inner === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure(scroller));
    observer.observe(inner);
    return () => observer.disconnect();
  }, [content, scroller]);

  return margin;
}
