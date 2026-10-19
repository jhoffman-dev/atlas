import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

/**
 * Where a viewer's theme choice is remembered.
 *
 * Per-viewer convenience rather than vault data, so it does not belong in a
 * note — but it is still I/O, so the component takes it as a port and the
 * composition root supplies the browser one.
 *
 * The store is the one place the choice lives: the sidebar's sun-or-moon
 * button and Settings → Appearance both read it and both change it, and each
 * hears the other's change through `subscribe`. So `read` answers with what
 * was last written or cleared this session, whether or not the store could
 * keep it for next time.
 */
export type ThemeStore = {
  /** `null` when nothing has been chosen, which is not an error. */
  read: () => Theme | null;
  write: (theme: Theme) => void;
  /** Forgets the choice, so the system's theme applies again. */
  clear: () => void;
  /** Hears every write and clear; returns the way to stop listening. */
  subscribe: (listener: () => void) => () => void;
};

const SYSTEM_DARK = '(prefers-color-scheme: dark)';

/** The system's preference, or null where it cannot be asked. */
function systemPreference(): MediaQueryList | null {
  // Absent in jsdom, and `matchMedia` can throw behind a strict privacy setting.
  try {
    return window.matchMedia?.(SYSTEM_DARK) ?? null;
  } catch {
    // Nothing to recover: with no answer, light is the documented default.
    return null;
  }
}

/** What the operating system asks for, when nothing has been chosen in the app. */
export function systemTheme(): Theme {
  return systemPreference()?.matches === true ? 'dark' : 'light';
}

/** Hears the system's preference change — Appearance in System Settings, or the schedule. */
function subscribeToSystem(listener: () => void): () => void {
  const preference = systemPreference();
  preference?.addEventListener('change', listener);
  return () => preference?.removeEventListener('change', listener);
}

/**
 * The theme in force, and the ways to change it: choose one, or match the
 * system again. The theme is the choice when there is one, else the system's,
 * followed live.
 *
 * Writes `data-theme` on the root element, which is the explicit choice the
 * stylesheet's guarded `prefers-color-scheme` block steps aside for.
 */
export function useTheme(store: ThemeStore): {
  theme: Theme;
  /** True while no choice is stored and the system's theme applies. */
  matching: boolean;
  setTheme: (theme: Theme) => void;
  matchSystem: () => void;
} {
  const choice = useSyncExternalStore(store.subscribe, store.read);
  const system = useSyncExternalStore(subscribeToSystem, systemTheme);
  const theme = choice ?? system;

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const setTheme = useCallback((next: Theme) => store.write(next), [store]);
  const matchSystem = useCallback(() => store.clear(), [store]);

  return { theme, matching: choice === null, setTheme, matchSystem };
}
