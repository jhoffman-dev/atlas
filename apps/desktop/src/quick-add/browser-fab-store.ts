import { isFabAnchor } from '@atlas/domain';
import type { FabAnchorStore } from '@atlas/ui';

const KEY = 'atlas.fab-anchor';

/**
 * Where the add button rests, kept in `localStorage` — per machine, not per
 * vault: where a hand reaches for it is about this screen, not about the notes.
 *
 * Every access is guarded: the accessor throws in a private window and wherever
 * site data is blocked. Neither is worth reporting — the button starts in its
 * default corner, as on a first run.
 */
export const browserFabStore: FabAnchorStore = {
  read: () => {
    try {
      const stored = window.localStorage.getItem(KEY);
      return isFabAnchor(stored) ? stored : null;
    } catch {
      return null;
    }
  },
  write: (anchor) => {
    try {
      window.localStorage.setItem(KEY, anchor);
    } catch {
      // Safe to ignore: the button stays where it was put for this session.
    }
  },
};
