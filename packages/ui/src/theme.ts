import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/**
 * Where a viewer's theme choice is remembered.
 *
 * Per-viewer convenience rather than vault data, so it does not belong in a
 * note — but it is still I/O, so the component takes it as a port and the
 * composition root supplies the browser one.
 */
export type ThemeStore = {
  /** `null` when nothing has been chosen, which is not an error. */
  read: () => Theme | null;
  write: (theme: Theme) => void;
};

/** What the operating system asks for, when nothing has been chosen in the app. */
export function systemTheme(): Theme {
  // Absent in jsdom, and `matchMedia` can throw behind a strict privacy setting.
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light';
  } catch {
    // Nothing to recover: with no answer, light is the documented default.
    return 'light';
  }
}

/**
 * The theme in force, and the way to change it.
 *
 * Writes `data-theme` on the root element, which is the explicit choice the
 * stylesheet's guarded `prefers-color-scheme` block steps aside for.
 */
export function useTheme(store: ThemeStore): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
} {
  const [theme, remember] = useState<Theme>(() => store.read() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      store.write(next);
      remember(next);
    },
    [store],
  );

  return { theme, setTheme };
}
