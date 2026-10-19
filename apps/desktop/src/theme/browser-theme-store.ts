import type { Theme, ThemeStore } from '@atlas/ui';

const KEY = 'atlas.theme';

const isTheme = (value: string | null): value is Theme => value === 'light' || value === 'dark';

/**
 * The theme choice, kept in `localStorage`.
 *
 * Every access is guarded: the accessor itself throws in a private window and
 * wherever site data is blocked, and a read can come back empty at any time.
 * Neither is an error worth showing — the app falls back to the system theme,
 * which is what it would have done on a first run anyway. A choice made this
 * session holds even where storage refuses it, as in
 * `browser-image-placement-store.ts`.
 */
export const browserThemeStore: ThemeStore = createBrowserThemeStore();

export function createBrowserThemeStore(): ThemeStore {
  // This session's choice or clearing, once one has been made; before that,
  // what storage holds. `null` inside is "cleared", which storage cannot say
  // apart from "never chosen" when it refuses the write.
  let session: { readonly choice: Theme | null } | null = null;
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());
  return {
    read: () => (session === null ? readStored() : session.choice),
    write: (theme) => {
      session = { choice: theme };
      try {
        window.localStorage.setItem(KEY, theme);
      } catch {
        // Safe to ignore: the choice still applies for this session, it just
        // will not be there next time.
      }
      tell();
    },
    clear: () => {
      session = { choice: null };
      try {
        window.localStorage.removeItem(KEY);
      } catch {
        // Safe to ignore, as for a write: the system theme applies for this
        // session, and the stored choice comes back next time.
      }
      tell();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function readStored(): Theme | null {
  try {
    const stored = window.localStorage.getItem(KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}
