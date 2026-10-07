import { parseRememberedPanes, rememberPanes } from '@atlas/domain';
import type { PaneLayoutStore } from './use-panes.ts';

const KEY = 'atlas.panes';

/**
 * How the window was split, kept in `localStorage`.
 *
 * Every access is guarded, as the theme's store and the sidebar's are: the
 * accessor itself throws in a private window and wherever site data is blocked,
 * and a read can come back empty or stale at any time. None of that is an error
 * worth showing — the window opens as one pane, which is what a first run does.
 */
export const browserPaneStore: PaneLayoutStore = {
  read: (vaultKey) => {
    try {
      const stored = window.localStorage.getItem(KEY);
      return stored === null ? null : parseRememberedPanes(JSON.parse(stored), vaultKey);
    } catch {
      return null;
    }
  },
  write: ({ vaultKey, layout }) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(rememberPanes({ layout, vaultKey })));
    } catch {
      // Safe to ignore: the split still holds for this session, it just will
      // not be there next time.
    }
  },
};
