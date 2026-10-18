import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The parts of a page whose list is held still, each a ref the page attaches. */
export interface ListAnchorParts {
  /** The element that scrolls the page. */
  readonly scroller: RefObject<HTMLElement | null>;
  /** The page inside it: what grows or shrinks as something above the list arrives. */
  readonly page: RefObject<HTMLElement | null>;
  /** A `display: contents` wrapper whose last child is the list; any before it sit above it. */
  readonly list: RefObject<HTMLElement | null>;
  /**
   * A `display: contents` wrapper of what the page says back to the person —
   * an undo bar, why an undo failed. It answers what they just did, so it is
   * let push the list down rather than scrolled out of their sight.
   */
  readonly answers: RefObject<HTMLElement | null>;
  /**
   * An empty block after the page, made tall enough to scroll by when the page
   * is too short. It must not shrink (`flex-shrink: 0`) in a flex scroller.
   */
  readonly room: RefObject<HTMLElement | null>;
}

/**
 * Where the anchor stood, in the scroller's content, and how tall the answers
 * above it were. The list is held by where it starts, whichever element draws
 * it — a list read again is drawn by "Reading…" for a moment — and a block by
 * the element itself.
 */
interface Placed {
  readonly anchor: Element | 'list';
  readonly element: Element;
  readonly at: number;
  readonly answers: number;
}

export interface ListAnchor {
  /** Something arrived above while the person was on the list, and is scrolled out of sight. */
  readonly newAbove: boolean;
  /** Scrolls back to what arrived above. */
  readonly showNewAbove: () => void;
}

/**
 * Holds a list still on screen as what sits above it arrives, grows or goes
 * (#130): manual scroll anchoring, which WebKit does not do, and which #247
 * turned off for virtualised lists. Once `live`, when the anchor's place in
 * the page moves the scroller is scrolled by as much — in the commit that
 * moved it, or, for a change the page did not commit, before the frame is
 * painted (a ResizeObserver runs after layout) — so nothing moves under the
 * pointer. A page too short to scroll that far is given room below it.
 *
 * The anchor is the list, unless the pointer or the focus is on something
 * above it — an offer being answered — which is then held instead, so a
 * preview opening under the pointer grows down, as it is drawn. Where it
 * stands is its place on screen plus how far the scroller is scrolled: the
 * list's own scrolling and the virtualiser's corrections cancel out, and a
 * banner the app puts above the whole pane counts as the move it is.
 *
 * Something arriving above the list while it is held is out of sight, so
 * `newAbove` says so until the person scrolls back to it or asks to.
 * Nothing here commits the page but that flag.
 */
export function useListAnchor(parts: ListAnchorParts, live: boolean): ListAnchor {
  const [newAbove, setNewAbove] = useState(false);
  const placed = useRef<Placed | null>(null);
  /** The block above the list under the pointer or holding the focus; null for the list. */
  const engaged = useRef<Element | null>(null);
  /** Where the scroller shows what arrived above, while `newAbove` holds. */
  const newAboveAt = useRef(0);
  const shown = useRef(false);
  const liveNow = useRef(live);
  /** Holds the anchor where it was, if it moved; set once the scroller is there. */
  const hold = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    liveNow.current = live;
    const area = parts.scroller.current;
    if (live && area !== null) placed.current = placeOf(parts, engaged.current, area);
  }, [live, parts]);

  useLayoutEffect(() => {
    const area = parts.scroller.current;
    const page = parts.page.current;
    if (area === null || page === null || typeof ResizeObserver === 'undefined') return;
    const flag = (on: boolean) => {
      if (shown.current === on) return;
      shown.current = on;
      setNewAbove(on);
    };
    const check = () => {
      const before = placed.current;
      const now = placeOf(parts, engaged.current, area);
      placed.current = now;
      if (!liveNow.current || before === null || before.anchor !== now.anchor) return;
      const shift = now.at - before.at - answersBetween(parts, now, before);
      if (shift === 0) return;
      scrollBy(parts, area, shift);
      placed.current = placeOf(parts, engaged.current, area);
      if (shift > 0 && engaged.current === null) {
        newAboveAt.current = area.scrollTop - shift;
        flag(true);
      }
    };
    hold.current = check;
    // For what changes without the page committing (a section's own state); a commit is held at once, below.
    const resized = new ResizeObserver(check);
    resized.observe(page);
    // The pane itself moving or shrinking, as a banner above it comes or goes.
    resized.observe(area);
    const onScroll = () => {
      giveBackRoom(parts, area);
      if (shown.current && area.scrollTop <= newAboveAt.current + 1) flag(false);
    };
    // The block the person is on is held instead of the list; read again as it changes.
    const engage = (event: Event) => {
      const block = blockOf(parts, event.target);
      if (block === engaged.current) return;
      engaged.current = block;
      placed.current = placeOf(parts, block, area);
    };
    const disengage = () => {
      if (engaged.current === null) return;
      engaged.current = null;
      placed.current = placeOf(parts, null, area);
    };
    area.addEventListener('scroll', onScroll, { passive: true });
    page.addEventListener('pointerover', engage);
    page.addEventListener('focusin', engage);
    page.addEventListener('pointerleave', disengage);
    return () => {
      hold.current = null;
      resized.disconnect();
      area.removeEventListener('scroll', onScroll);
      page.removeEventListener('pointerover', engage);
      page.removeEventListener('focusin', engage);
      page.removeEventListener('pointerleave', disengage);
    };
  }, [parts]);

  // After every commit of the page, before anything else can run: an input
  // handled before the browser's next ResizeObserver pass would otherwise be
  // aimed at the rows where they were pushed to, for that moment.
  useLayoutEffect(() => hold.current?.());

  const showNewAbove = useCallback(() => {
    parts.scroller.current?.scrollTo({ top: Math.max(0, newAboveAt.current) });
    shown.current = false;
    setNewAbove(false);
  }, [parts]);

  return { newAbove, showNewAbove };
}

/** The list's own element: the last child of its wrapper. */
function listOf(parts: ListAnchorParts): Element | null {
  return parts.list.current?.lastElementChild ?? null;
}

/** Where the anchor is now, with the person on `block` (null for the list). */
function placeOf(parts: ListAnchorParts, block: Element | null, area: HTMLElement): Placed {
  const element = block?.isConnected === true ? block : (listOf(parts) ?? area);
  const anchor = element === block ? block : 'list';
  return { anchor, element, at: standing(element, area), answers: answersHeight(parts) };
}

/** Where `element` stands, however far the scroller is scrolled: on screen, plus the scroll. */
function standing(element: Element, area: HTMLElement): number {
  return element.getBoundingClientRect().top + area.scrollTop;
}

/** How far down the scroller's content `element` starts, however far it is scrolled. */
function contentTop(element: Element, area: HTMLElement): number {
  return element.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop;
}

/** How much room the page's answers take, with the gap the page leaves after each. */
function answersHeight(parts: ListAnchorParts): number {
  const answers = parts.answers.current;
  const page = parts.page.current;
  if (answers === null || page === null) return 0;
  const gap = Number.parseFloat(getComputedStyle(page).rowGap) || 0;
  let height = 0;
  for (const child of answers.children) height += child.getBoundingClientRect().height + gap;
  return height;
}

/** How much of a move the answers made, when they sit above the anchor: not held against. */
function answersBetween(parts: ListAnchorParts, now: Placed, before: Placed): number {
  const answers = parts.answers.current;
  if (answers === null) return 0;
  const above =
    (answers.compareDocumentPosition(now.element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return above ? now.answers - before.answers : 0;
}

/** The block of the page `target` is in, or null when it is the list or outside the page. */
function blockOf(parts: ListAnchorParts, target: EventTarget | null): Element | null {
  const page = parts.page.current;
  const wrappers = [page, parts.list.current, parts.answers.current];
  for (let at = target instanceof Element ? target : null; at !== null; at = at.parentElement) {
    if (at === page) return null;
    if (at.parentElement !== null && wrappers.includes(at.parentElement)) {
      return at === listOf(parts) ? null : at;
    }
  }
  return null;
}

/** Scrolls by `shift`, giving the page room below first when it is too short to scroll that far. */
function scrollBy(parts: ListAnchorParts, area: HTMLElement, shift: number): void {
  const room = parts.room.current;
  // Whole pixels, as the scroller keeps them: within half a pixel of where the anchor was.
  const target = Math.max(0, Math.round(area.scrollTop + shift));
  if (room !== null) {
    // Measured to the room's end, not by `scrollHeight`, which is never less than the view.
    const end = contentTop(room, area) + roomOf(room);
    const short = target + area.clientHeight - end;
    if (short > 0) room.style.height = `${roomOf(room) + short}px`;
  }
  area.scrollTop = target;
}

/** Takes back the room given below the page as the person scrolls up out of it. */
function giveBackRoom(parts: ListAnchorParts, area: HTMLElement): void {
  const room = parts.room.current;
  if (room === null) return;
  const given = roomOf(room);
  if (given === 0) return;
  const spare = contentTop(room, area) + given - (area.scrollTop + area.clientHeight);
  if (spare > 0) room.style.height = `${Math.max(0, given - spare)}px`;
}

const roomOf = (room: HTMLElement) => Number.parseFloat(room.style.height) || 0;
