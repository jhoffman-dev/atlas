// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserFabStore } from './browser-fab-store.ts';

const KEY = 'atlas.fab-anchor';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('browserFabStore', () => {
  it('round-trips where the button was put', () => {
    browserFabStore.write('top-left');
    expect(browserFabStore.read()).toBe('top-left');
    expect(window.localStorage.getItem(KEY)).toBe('top-left');
  });

  it('reads nothing on a first run', () => {
    expect(browserFabStore.read()).toBeNull();
  });

  it('reads nothing rather than trusting a place it does not know', () => {
    window.localStorage.setItem(KEY, 'centre');
    expect(browserFabStore.read()).toBeNull();
  });

  it('reads nothing, and writes nothing, when storage is denied', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });
    expect(browserFabStore.read()).toBeNull();
    expect(() => browserFabStore.write('top-left')).not.toThrow();
  });

  it('keeps going when a write is refused, as when storage is full', () => {
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage);
    expect(() => browserFabStore.write('bottom-left')).not.toThrow();
  });
});
