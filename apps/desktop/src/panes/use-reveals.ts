import { useCallback, useRef, useState } from 'react';
import type { LinkFragment, VaultPath } from '@atlas/domain';
import type { NoteReveal } from '@atlas/ui';

/** A block or heading asked to be brought into view in a pane, and the note it is in. */
interface PaneReveal {
  readonly path: VaultPath;
  readonly reveal: NoteReveal;
}

/**
 * Where each pane was asked to scroll to (P26-03): a followed `[[Note#^id]]`
 * or a shown block's source opens the note at that block. The request is
 * kept for the note it was made for, so a pane that has since moved on to
 * another note is not scrolled; each request has its own key, so following
 * the same link twice scrolls there twice. A request is spent once shown.
 */
export function useReveals(): {
  readonly request: (args: { pane: number; path: VaultPath; fragment: LinkFragment }) => void;
  readonly revealFor: (pane: number, path: VaultPath | null) => NoteReveal | null;
} {
  const [reveals, setReveals] = useState<ReadonlyMap<number, PaneReveal>>(new Map());
  const asked = useRef(0);
  const request = useCallback(
    ({ pane, path, fragment }: { pane: number; path: VaultPath; fragment: LinkFragment }) => {
      asked.current += 1;
      const key = asked.current;
      // Spent once shown, so the note opened there again later is not scrolled again.
      const done = () =>
        setReveals((before) => {
          if (before.get(pane)?.reveal.key !== key) return before;
          const next = new Map(before);
          next.delete(pane);
          return next;
        });
      const reveal = { fragment, key, done };
      setReveals((before) => new Map(before).set(pane, { path, reveal }));
    },
    [],
  );
  const revealFor = useCallback(
    (pane: number, path: VaultPath | null) => {
      const found = reveals.get(pane);
      return found !== undefined && found.path === path ? found.reveal : null;
    },
    [reveals],
  );
  return { request, revealFor };
}
