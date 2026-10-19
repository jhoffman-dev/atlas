// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSettings } from './appearance-settings.tsx';
import { ThemeSwitch } from './theme-switch.tsx';
import { themeStoreHolding } from './theme-test-support.ts';
import { useTheme, type ThemeStore } from './theme.ts';

/**
 * Attack on PR #371 (slice 13f): `useTheme` over `useSyncExternalStore` and
 * `matchMedia` — listener hygiene, a real browser's fresh MediaQueryList per
 * call, quick toggling, and the sidebar and Settings staying one state.
 */

/**
 * A `matchMedia` that, like a browser, hands back a new MediaQueryList on every
 * call, all sharing one answer; counts the change listeners attached.
 */
function freshListsPreferring(dark: boolean) {
  let matches = dark;
  const listeners = new Set<() => void>();
  const matchMedia = vi.fn(
    () =>
      ({
        get matches() {
          return matches;
        },
        media: '(prefers-color-scheme: dark)',
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return {
    matchMedia,
    listeners,
    prefer: (next: boolean) => {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

/** A store that counts who is listening. */
function countingStore(initial: 'light' | 'dark' | null) {
  const inner = themeStoreHolding(initial);
  let live = 0;
  const store: ThemeStore & { written: (string | null)[] } = {
    ...inner,
    written: inner.written,
    subscribe: (listener) => {
      live += 1;
      const stop = inner.subscribe(listener);
      return () => {
        live -= 1;
        stop();
      };
    },
  };
  return { store, live: () => live };
}

function Reader({ store }: { store: ThemeStore }) {
  const { theme, matching } = useTheme(store);
  return <output data-testid="reader">{`${theme} ${matching ? 'matching' : 'chosen'}`}</output>;
}

const reading = () => screen.getByTestId('reader').textContent;
const rootTheme = () => document.documentElement.dataset['theme'];
const matchSwitch = () => screen.getByRole('switch', { name: 'Match system' });

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['theme'];
});

describe('useTheme, attack 371', () => {
  it('leaves no store or system listener behind once every reader unmounts', () => {
    const system = freshListsPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    const { store, live } = countingStore(null);
    const view = render(
      <>
        <Reader store={store} />
        <ThemeSwitch store={store} />
        <AppearanceSettings store={store} />
      </>,
    );
    expect(live()).toBe(3);
    expect(system.listeners.size).toBe(3);
    view.unmount();
    expect(live()).toBe(0);
    expect(system.listeners.size).toBe(0);
  });

  it('follows the system live where every matchMedia call returns a new list', () => {
    const system = freshListsPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    render(<Reader store={themeStoreHolding(null)} />);
    act(() => system.prefer(true));
    expect(reading()).toBe('dark matching');
    expect(rootTheme()).toBe('dark');
  });

  it('ignores the system changing while a choice is held, and follows it again once matching', () => {
    const system = freshListsPreferring(true);
    vi.stubGlobal('matchMedia', system.matchMedia);
    const store = themeStoreHolding('light');
    render(<Reader store={store} />);
    act(() => system.prefer(false));
    act(() => system.prefer(true));
    expect(reading()).toBe('light chosen');
    act(() => store.clear());
    expect(reading()).toBe('dark matching');
    act(() => system.prefer(false));
    expect(reading()).toBe('light matching');
    expect(rootTheme()).toBe('light');
  });

  it('falls back to light, without throwing, when matchMedia throws', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('blocked');
    });
    render(<Reader store={themeStoreHolding(null)} />);
    expect(reading()).toBe('light matching');
  });

  it('turning Match system off keeps what macOS is showing, as the choice', async () => {
    const system = freshListsPreferring(true);
    vi.stubGlobal('matchMedia', system.matchMedia);
    const store = themeStoreHolding(null);
    render(<AppearanceSettings store={store} />);
    await userEvent.click(matchSwitch());
    expect(store.written).toEqual(['dark']);
    expect(matchSwitch().getAttribute('aria-checked')).toBe('false');
    // macOS flips afterwards: the choice holds.
    act(() => system.prefer(false));
    expect(rootTheme()).toBe('dark');
  });

  it('a quick on, off, on, off ends with the theme that was showing chosen', async () => {
    const system = freshListsPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    const store = themeStoreHolding('dark');
    render(<AppearanceSettings store={store} />);
    const user = userEvent.setup({ delay: null });
    await user.click(matchSwitch());
    await user.click(matchSwitch());
    await user.click(matchSwitch());
    await user.click(matchSwitch());
    // on: cleared (system light shows); off: light kept; on; off: light kept.
    expect(store.written).toEqual([null, 'light', null, 'light']);
    expect(store.read()).toBe('light');
    expect(rootTheme()).toBe('light');
  });

  it('a Match system click and the sidebar button are one state, in both directions', async () => {
    const system = freshListsPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    const store = themeStoreHolding(null);
    render(
      <>
        <ThemeSwitch store={store} />
        <AppearanceSettings store={store} />
      </>,
    );
    expect(matchSwitch().getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(matchSwitch().getAttribute('aria-checked')).toBe('false');
    await userEvent.click(matchSwitch());
    expect(matchSwitch().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
    expect(rootTheme()).toBe('light');
  });

  it('subscribes to the store once per reader, not once per render', () => {
    const system = freshListsPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    const { store, live } = countingStore(null);
    render(<Reader store={store} />);
    for (let i = 0; i < 5; i += 1) act(() => system.prefer(i % 2 === 0));
    act(() => store.write('dark'));
    act(() => store.clear());
    expect(live()).toBe(1);
    expect(system.listeners.size).toBe(1);
  });
});
