import { useCallback, useState } from 'react';
import { createLinkHover, windowTimer, type HoverTimer } from './link-hover.ts';
import type { AnchorRect } from './preview-placement.ts';

/** What a hovered link points at: a wikilink's target as written, or a relation value's note. */
export type PreviewTarget =
  | { readonly kind: 'link'; readonly link: string }
  | { readonly kind: 'note'; readonly path: string };

/** The link the pointer has rested on, and where it is on screen. */
export interface HoveredLink {
  readonly target: PreviewTarget;
  readonly anchor: AnchorRect;
}

/**
 * The elements that preview (Q22, James 2026-10-18): a wikilink in a note's
 * text, and a relation value — `LinkedNote`, in a cell, the properties strip
 * or the aside. Sidebar rows and board cards draw neither, so they never do.
 */
const PREVIEWS = 'a.wikilink[data-wikilink], [data-link-path]';

/** The previewing link an element is part of, inside `within`; null for none. */
export function previewingLinkOf(element: EventTarget | null, within: Element): Element | null {
  if (!(element instanceof Element)) return null;
  const link = element.closest(PREVIEWS);
  return link !== null && within.contains(link) ? link : null;
}

function targetOf(link: Element): PreviewTarget {
  const path = link.getAttribute('data-link-path');
  return path !== null
    ? { kind: 'note', path }
    : { kind: 'link', link: link.getAttribute('data-wikilink') ?? '' };
}

/** A hovered link, and the ref that names where links are watched for. */
export interface LinkHoverState {
  /** Set as the `ref` of the element whose links preview. */
  readonly watch: (root: HTMLElement | null) => (() => void) | undefined;
  /** The link the pointer has rested on, else null. */
  readonly hovered: HoveredLink | null;
}

/**
 * The link preview under one element, after the 400 ms rule.
 *
 * Listens on that element alone, by delegation: no listener per link, and
 * no render until a card is due — a still pointer, or one off every link,
 * costs nothing. A press or a wheel inside it, or a key anywhere, hides the
 * card, so typing and clicking (which peeks) are never covered. `watch`
 * is a callback ref, so an element that mounts later — a peek's body — is
 * watched from the moment it is there, without a render to find it.
 */
export function useLinkHover(timer: HoverTimer = windowTimer): LinkHoverState {
  const [hovered, setHovered] = useState<HoveredLink | null>(null);
  const watch = useCallback(
    (root: HTMLElement | null) => (root === null ? undefined : listen(root, timer, setHovered)),
    [timer],
  );
  return { watch, hovered };
}

/** Starts watching `root`'s links; the function it returns stops. */
function listen(
  root: HTMLElement,
  timer: HoverTimer,
  setHovered: (hovered: HoveredLink | null) => void,
): () => void {
  const links = createLinkHover<Element>({
    timer,
    onShow: (link) => {
      const box = link.getBoundingClientRect();
      setHovered({
        target: targetOf(link),
        anchor: { left: box.left, top: box.top, bottom: box.bottom },
      });
    },
    onHide: () => setHovered(null),
  });
  // A key anywhere hides the card, wherever the focus is; listened for only
  // while a link is hovered, so typing with the pointer elsewhere costs nothing.
  const keys = root.ownerDocument;
  const dismiss = () => {
    links.dismiss();
    keys.removeEventListener('keydown', dismiss, true);
  };
  const over = (event: Event) => {
    const link = previewingLinkOf(event.target, root);
    if (link === null) return dismiss();
    links.enter(link);
    keys.addEventListener('keydown', dismiss, true);
  };
  const out = (event: Event) => {
    const next = (event as PointerEvent).relatedTarget;
    if (!(next instanceof Node) || !root.contains(next)) dismiss();
  };
  const listened = [
    ['pointerover', over],
    ['pointerout', out],
    ['pointerdown', dismiss],
    ['wheel', dismiss],
  ] as const;
  for (const [type, listener] of listened) root.addEventListener(type, listener, { passive: true });
  return () => {
    dismiss();
    for (const [type, listener] of listened) root.removeEventListener(type, listener);
  };
}
