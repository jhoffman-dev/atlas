// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserThemeStore } from './browser-theme-store.ts';

const KEY = 'atlas.theme';

/** Replaces `window.localStorage` for one test. */
const withStorage = (storage: Partial<Storage>) => {
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage as Storage);
};

/** The accessor itself throws in a private window, before any method is called. */
const withDeniedStorage = () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('The operation is insecure.');
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('browserThemeStore', () => {
  it('round-trips a choice', () => {
    browserThemeStore.write('dark');
    expect(browserThemeStore.read()).toBe('dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
  });

  it('reads nothing when no choice has been made', () => {
    expect(browserThemeStore.read()).toBeNull();
  });

  it('reads nothing rather than trusting a value it does not recognise', () => {
    window.localStorage.setItem(KEY, 'solarized');
    expect(browserThemeStore.read()).toBeNull();
  });

  it('reads nothing when the accessor throws, as in a private window', () => {
    withDeniedStorage();
    expect(browserThemeStore.read()).toBeNull();
  });

  it('reads nothing when the read itself throws', () => {
    withStorage({
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(browserThemeStore.read()).toBeNull();
  });

  it('swallows a write the browser refuses, so the app carries on', () => {
    withDeniedStorage();
    expect(() => browserThemeStore.write('dark')).not.toThrow();
  });

  it('swallows a write that fails on quota', () => {
    withStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => browserThemeStore.write('light')).not.toThrow();
  });
});
