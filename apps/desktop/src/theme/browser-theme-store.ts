import type { Theme, ThemeStore } from '@atlas/ui';

const KEY = 'atlas.theme';

const isTheme = (value: string | null): value is Theme => value === 'light' || value === 'dark';

/**
 * The theme choice, kept in `localStorage`.
 *
 * Every access is guarded: the accessor itself throws in a private window and
 * wherever site data is blocked, and a read can come back empty at any time.
 * Neither is an error worth showing — the app falls back to the system theme,
 * which is what it would have done on a first run anyway.
 */
export const browserThemeStore: ThemeStore = {
  read: () => {
    try {
      const stored = window.localStorage.getItem(KEY);
      return isTheme(stored) ? stored : null;
    } catch {
      return null;
    }
  },
  write: (theme) => {
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      // Safe to ignore: the choice still applies for this session, it just
      // will not be there next time.
    }
  },
};
