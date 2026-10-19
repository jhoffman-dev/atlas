import type { Theme, ThemeStore } from './theme.ts';

/**
 * A theme store held in memory, standing in for `localStorage` in tests: it
 * remembers, tells its listeners, and records what was written.
 */
export function themeStoreHolding(
  initial: Theme | null,
): ThemeStore & { readonly written: (Theme | null)[] } {
  let held = initial;
  const written: (Theme | null)[] = [];
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());
  return {
    written,
    read: () => held,
    write: (theme) => {
      held = theme;
      written.push(theme);
      tell();
    },
    clear: () => {
      held = null;
      written.push(null);
      tell();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A `matchMedia` answering the dark-scheme query with `dark`, whose answer
 * a test can change — the listeners then hear it, as they would from macOS.
 */
export function systemPreferring(dark: boolean): {
  matchMedia: (query: string) => MediaQueryList;
  prefer: (dark: boolean) => void;
} {
  const listeners = new Set<() => void>();
  let matches = dark;
  const list = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    // Only what `theme.ts` reads of a MediaQueryList is here; the rest is never asked for.
    matchMedia: () => list as unknown as MediaQueryList,
    prefer: (next) => {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}
