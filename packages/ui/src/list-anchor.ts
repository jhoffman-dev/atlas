import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The parts of a page whose list is held still, each a ref the page attaches. */
export interface ListAnchorParts {
  /**
   * The element that scrolls the page. It must have `overflow-anchor: none`:
   * a browser anchoring it too would correct each move a second time.
   */
  readonly scroller: RefObject<HTMLElement | null>;
  /** The page inside it: what grows or shrinks as something above the list arrives. */
  readonly page: RefObject<HTMLElement | null>;
  /** A `display: contents` wrapper whose last child is the list; any before it sit above it. */
  readonly list: RefObject<HTMLElement | null>;
  /**
   * A `display: contents` wrapper of what the page says back to the person —
   * why an undo failed. It answers what they just did, so as it
   * comes it is let push the list down rather than scrolled out of their
   * sight; as it goes, the list is held.
   */
  readonly answers: RefObject<HTMLElement | null>;
  /**
   * An empty block after the page, made tall enough to scroll by when the page
   * is too short. It must not shrink (`flex-shrink: 0`) in a flex scroller.
   */
  readonly room: RefObject<HTMLElement | null>;
}

/**
 * Where the anchor stood, and what the page was like then. The list is held
 * by where it starts, whichever element draws it — a list read again is drawn
 * by "Reading…" for a moment — and a block by the element itself.
 */
interface Placed {
  readonly anchor: Element | 'list';
  readonly element: Element;
  /** Its place on screen plus how far the scroller is scrolled. */
  readonly at: number;
  /** How tall the answers above the list were. */
  readonly answers: number;
  /** How wide the page was: a change of width is a reflow, not an arrival. */
  readonly width: number;
  readonly scrollTop: number;
  /** Where the scroller is on screen: a banner above the pane moves it, and that is no arrival in it. */
  readonly areaTop: number;
  /** The page's blocks, to tell what arrived. */
  readonly blocks: readonly Element[];
}

/** What arrived above the list, out of sight, while "New above" says so. */
interface Arrival {
  /** The block that arrived, or null when something already there grew. */
  readonly element: Element | null;
  /** Where it starts in the scroller's content. */
  readonly top: number;
}

export interface ListAnchor {
  /** Something arrived above while the person was on the list, and is out of sight. */
  readonly newAbove: boolean;
  /** Scrolls to what arrived above. */
  readonly showNewAbove: () => void;
}

/**
 * Holds a list still on screen as what sits above it arrives, grows or goes
 * (#130): manual scroll anchoring, in place of the browser's (which #247 had
 * to keep away from virtualised lists, and which the scroller turns off, or
 * the two would correct each move twice). Once `live`, when the anchor's
 * place moves the scroller is scrolled by as much — in the commit that moved
 * it, or, for a change the page did not commit, before the frame is painted
 * (a ResizeObserver runs after layout) — so nothing moves under the pointer.
 * A page too short to scroll that far is given room below it.
 *
 * The anchor is the list, unless the pointer or the focus is on something
 * above it — an offer being answered — which is then held instead, so a
 * preview opening under the pointer grows down. Where it stands is its place
 * on screen plus how far the scroller is scrolled: the list's own scrolling
 * and the virtualiser's corrections cancel out, and a banner the app puts
 * above the whole pane counts as the move it is.
 *
 * A reflow — the page made narrower or wider — is held too, but is not news;
 * at the very top of the page it is left alone, so the heading stays in view.
 * Something that arrives above the list and is out of sight sets `newAbove`
 * until it is scrolled into view or the person asks to be taken to it.
 */
export function useListAnchor(parts: ListAnchorParts, live: boolean): ListAnchor {
  const [newAbove, setNewAbove] = useState(false);
  const placed = useRef<Placed | null>(null);
  /** The block above the list under the pointer or holding the focus; null for the list. */
  const engaged = useRef<Element | null>(null);
  const arrival = useRef<Arrival | null>(null);
  const liveNow = useRef(live);
  /** Holds the anchor where it was, if it moved; set once the scroller is there. */
  const hold = useRef<(() => void) | null>(null);

  /** Says what arrived above, or that nothing is waiting there; commits only when that changes. */
  const say = useCallback((next: Arrival | null) => {
    const was = arrival.current !== null;
    arrival.current = next;
    if (was !== (next !== null)) setNewAbove(next !== null);
  }, []);

  useLayoutEffect(() => {
    liveNow.current = live;
    const area = parts.scroller.current;
    if (live && area !== null) placed.current = placeOf(parts, engaged.current, area);
  }, [live, parts]);

  useLayoutEffect(() => {
    const area = parts.scroller.current;
    const page = parts.page.current;
    if (area === null || page === null || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      const before = placed.current;
      const now = placeOf(parts, engaged.current, area);
      placed.current = now;
      if (!liveNow.current || before === null || before.anchor !== now.anchor) return;
      const reflowed = now.width !== before.width;
      if (reflowed && before.scrollTop === 0) return;
      const shift = now.at - before.at - answersCame(parts, now, before);
      if (shift === 0) return;
      const inPage = shift - (now.areaTop - before.areaTop);
      const arrived = inPage > 0 && !reflowed && engaged.current === null;
      const what = arrived ? arrivalOf(before, now, area, inPage) : null;
      scrollBy(parts, area, shift);
      placed.current = placeOf(parts, engaged.current, area);
      if (what !== null && !inView(what, area)) say(topmost(arrival.current, what, area));
    };
    hold.current = check;
    // For what changes without the page committing (a section's own state); a commit is held at once, below.
    const resized = new ResizeObserver(check);
    resized.observe(page);
    // The pane itself moving or shrinking, as a banner above it comes or goes or the window resizes.
    resized.observe(area);
    const onScroll = () => {
      giveBackRoom(parts, area);
      const waiting = arrival.current;
      if (waiting !== null && (isGone(waiting) || inView(waiting, area))) say(null);
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
  }, [parts, say]);

  // After every commit of the page, before anything else can run: an input
  // handled before the browser's next ResizeObserver pass would otherwise be
  // aimed at the rows where they were pushed to, for that moment.
  useLayoutEffect(() => hold.current?.());

  const showNewAbove = useCallback(() => {
    const area = parts.scroller.current;
    const waiting = arrival.current;
    if (area !== null && waiting !== null) {
      const top =
        waiting.element?.isConnected === true ? contentTop(waiting.element, area) : waiting.top;
      area.scrollTo({ top: Math.max(0, top - ARRIVAL_MARGIN) });
    }
    say(null);
  }, [parts, say]);

  return { newAbove, showNewAbove };
}

/** How far above what arrived "New above" stops, so its top edge is not flush with the pane's. */
const ARRIVAL_MARGIN = 8;

/** The list's own element: the last child of its wrapper. */
function listOf(parts: ListAnchorParts): Element | null {
  return parts.list.current?.lastElementChild ?? null;
}

/** Where the anchor is now, with the person on `block` (null for the list). */
function placeOf(parts: ListAnchorParts, block: Element | null, area: HTMLElement): Placed {
  const element = block?.isConnected === true ? block : (listOf(parts) ?? area);
  return {
    anchor: element === block ? block : 'list',
    element,
    at: element.getBoundingClientRect().top + area.scrollTop,
    answers: answersHeight(parts),
    width: parts.page.current?.getBoundingClientRect().width ?? 0,
    scrollTop: area.scrollTop,
    areaTop: area.getBoundingClientRect().top,
    blocks: blocksOf(parts),
  };
}

/** The page's blocks, in order, through its `display: contents` wrappers. */
function blocksOf(parts: ListAnchorParts): readonly Element[] {
  const wrappers = [parts.list.current, parts.answers.current];
  return [...(parts.page.current?.children ?? [])].flatMap((child) =>
    wrappers.includes(child as HTMLElement) ? [...child.children] : [child],
  );
}

/**
 * What arrived above the anchor: the first block that is new since `before`,
 * or, when something already there grew, the room just above the anchor.
 */
function arrivalOf(before: Placed, now: Placed, area: HTMLElement, shift: number): Arrival {
  const added = now.blocks.find(
    (block) =>
      !before.blocks.includes(block) &&
      (block.compareDocumentPosition(now.element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  if (added !== undefined) return { element: added, top: contentTop(added, area) };
  return { element: null, top: contentTop(now.element, area) - shift };
}

/** Whether what arrived is in view: its top edge on screen, so the person sees it start. */
function inView(what: Arrival, area: HTMLElement): boolean {
  const top = what.element?.isConnected === true ? contentTop(what.element, area) : what.top;
  return top >= area.scrollTop - 1 && top < area.scrollTop + area.clientHeight;
}

/** Of what is already waiting above and what just arrived, the one higher up the page: "New above" goes there first. */
function topmost(waiting: Arrival | null, what: Arrival, area: HTMLElement): Arrival {
  if (waiting === null || isGone(waiting) || inView(waiting, area)) return what;
  const topOf = (each: Arrival) =>
    each.element?.isConnected === true ? contentTop(each.element, area) : each.top;
  return topOf(waiting) <= topOf(what) ? waiting : what;
}

const isGone = (what: Arrival) => what.element !== null && !what.element.isConnected;

/** How far down the scroller's content `element` starts, however far it is scrolled. */
function contentTop(element: Element, area: HTMLElement): number {
  return element.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop;
}

/** How much room the page's answers take: each with its margins, and the gap the page leaves after it. */
function answersHeight(parts: ListAnchorParts): number {
  const answers = parts.answers.current;
  const page = parts.page.current;
  if (answers === null || page === null) return 0;
  const gap = Number.parseFloat(getComputedStyle(page).rowGap) || 0;
  let height = 0;
  for (const child of answers.children) {
    const { marginTop, marginBottom } = getComputedStyle(child);
    height += child.getBoundingClientRect().height + gap;
    height += (Number.parseFloat(marginTop) || 0) + (Number.parseFloat(marginBottom) || 0);
  }
  return height;
}

/**
 * How much of a move came from the answers growing above the anchor: let
 * through. Answers going — one dismissed, say — are nothing the person
 * did, so the list is held as they shrink.
 */
function answersCame(parts: ListAnchorParts, now: Placed, before: Placed): number {
  const answers = parts.answers.current;
  if (answers === null) return 0;
  const above =
    (answers.compareDocumentPosition(now.element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return above ? Math.max(0, now.answers - before.answers) : 0;
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
