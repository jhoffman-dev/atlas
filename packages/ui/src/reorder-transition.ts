import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** How long a moved item takes to slide to its new place. */
const SLIDE_MS = 200;
const SLIDE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Slides a list through a reorder: each item moves from where it was to where
 * it now is, rather than jumping.
 *
 * Items are the elements under `root` marked `data-reorder-id`. Call the
 * returned `beforeReorder` in the handler that is about to change the order —
 * that is the last moment the old places can be read. The slide is skipped
 * when the viewer asks for reduced motion, and wherever the browser cannot
 * animate. (Focus needs no help: React puts it back on an element it moved.)
 */
export function useReorderTransition(root: RefObject<HTMLElement | null>): () => void {
  const pending = useRef<ReadonlyMap<string, number> | null>(null);

  const beforeReorder = useCallback(() => {
    const node = root.current;
    if (node !== null) pending.current = topsOf(node);
  }, [root]);

  // Every commit, not only when the order changes: a snapshot is taken only
  // when a reorder is on its way, and this is where it lands.
  useLayoutEffect(() => {
    const before = pending.current;
    const node = root.current;
    if (before === null || node === null) return;
    pending.current = null;
    if (!prefersReducedMotion(node)) slide(node, before);
  });

  return beforeReorder;
}

function items(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>('[data-reorder-id]')];
}

function topsOf(node: HTMLElement): Map<string, number> {
  return new Map(
    items(node).map((item) => [item.dataset.reorderId ?? '', item.getBoundingClientRect().top]),
  );
}

function slide(node: HTMLElement, before: ReadonlyMap<string, number>): void {
  for (const item of items(node)) {
    const was = before.get(item.dataset.reorderId ?? '');
    if (was === undefined || typeof item.animate !== 'function') continue;
    const by = was - item.getBoundingClientRect().top;
    if (Math.abs(by) < 1) continue;
    item.animate([{ transform: `translateY(${by}px)` }, { transform: 'none' }], {
      duration: SLIDE_MS,
      easing: SLIDE_EASING,
    });
  }
}

function prefersReducedMotion(node: HTMLElement): boolean {
  const view = node.ownerDocument.defaultView;
  if (view === null || typeof view.matchMedia !== 'function') return false;
  return view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
