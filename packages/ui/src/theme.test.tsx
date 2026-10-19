// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSettings } from './appearance-settings.tsx';
import { ThemeSwitch } from './theme-switch.tsx';
import { systemPreferring, themeStoreHolding } from './theme-test-support.ts';
import { systemTheme, useTheme, type ThemeStore } from './theme.ts';

/**
 * `useTheme` (UI v2 slice 13f): the theme is the stored choice when there is
 * one, else the system's, followed live; and every component reading it sees
 * the same thing, since the choice lives in the store rather than in any one
 * of them.
 */

function Reader({ store }: { store: ThemeStore }) {
  const { theme, matching } = useTheme(store);
  return <output data-testid="reader">{`${theme} ${matching ? 'matching' : 'chosen'}`}</output>;
}

const reading = () => screen.getByTestId('reader').textContent;
const rootTheme = () => document.documentElement.dataset['theme'];

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['theme'];
});

describe('useTheme', () => {
  it('is the choice when one is stored', () => {
    vi.stubGlobal('matchMedia', systemPreferring(true).matchMedia);
    render(<Reader store={themeStoreHolding('light')} />);
    expect(reading()).toBe('light chosen');
    expect(rootTheme()).toBe('light');
  });

  it('is the system’s when nothing is stored, and follows it as it changes', () => {
    const system = systemPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    render(<Reader store={themeStoreHolding(null)} />);
    expect(reading()).toBe('light matching');

    act(() => system.prefer(true));
    expect(reading()).toBe('dark matching');
    expect(rootTheme()).toBe('dark');

    act(() => system.prefer(false));
    expect(reading()).toBe('light matching');
    expect(rootTheme()).toBe('light');
  });

  it('ignores the system while a choice is stored', () => {
    const system = systemPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    render(<Reader store={themeStoreHolding('dark')} />);

    act(() => system.prefer(true));
    act(() => system.prefer(false));

    expect(reading()).toBe('dark chosen');
    expect(rootTheme()).toBe('dark');
  });

  it('stops listening to the system once unmounted', () => {
    const system = systemPreferring(false);
    vi.stubGlobal('matchMedia', system.matchMedia);
    const { unmount } = render(<Reader store={themeStoreHolding(null)} />);
    unmount();
    // A listener left behind would set the root from a component that is gone.
    delete document.documentElement.dataset['theme'];
    act(() => system.prefer(true));
    expect(rootTheme()).toBeUndefined();
  });

  it('is one theme for every reader: the sidebar’s button and Settings agree', async () => {
    vi.stubGlobal('matchMedia', systemPreferring(false).matchMedia);
    const store = themeStoreHolding(null);
    render(
      <>
        <ThemeSwitch store={store} />
        <AppearanceSettings store={store} />
      </>,
    );
    const matchSystem = () => screen.getByRole('switch', { name: 'Match system' });
    expect(matchSystem().getAttribute('aria-checked')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(matchSystem().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeDefined();

    await userEvent.click(matchSystem());
    expect(matchSystem().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeDefined();
    expect(rootTheme()).toBe('light');
  });
});

describe('systemTheme', () => {
  it('is light where the system cannot be asked', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(systemTheme()).toBe('light');
  });

  it('is light where asking throws, as behind a strict privacy setting', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => {
        throw new Error('denied');
      }),
    );
    expect(systemTheme()).toBe('light');
  });

  it('is dark when the system prefers it', () => {
    vi.stubGlobal('matchMedia', systemPreferring(true).matchMedia);
    expect(systemTheme()).toBe('dark');
  });
});
