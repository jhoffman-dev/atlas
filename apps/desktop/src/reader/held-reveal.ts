import { useEffect, useState } from 'react';
import type { NoteReveal, ReaderReveal } from '@dfai/ui';

/**
 * The last highlight the tab was asked to show, held here once the ask is
 * spent: the reader may still be loading, or its highlights still being
 * placed, and shows it when it can.
 */
export function useHeldReveal(asked: NoteReveal | null): ReaderReveal | null {
  const [held, setHeld] = useState<ReaderReveal | null>(null);
  const [seen, setSeen] = useState(asked);
  if (asked !== seen) {
    setSeen(asked);
    if (asked?.fragment.kind === 'block')
      setHeld({ id: asked.fragment.id, key: Number(asked.key) });
  }
  // Spent once held, so the tab opened on this file again later is not brought there again.
  useEffect(() => asked?.done?.(), [asked]);
  return held;
}
