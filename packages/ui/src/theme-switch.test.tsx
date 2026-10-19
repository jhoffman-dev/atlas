// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSwitch } from './theme-switch.tsx';
import { systemPreferring, themeStoreHolding } from './theme-test-support.ts';

/** The one button, named for the theme it would switch to. */
const toDark = () => screen.getByRole('button', { name: 'Switch to dark theme' });
const toLight = () => screen.getByRole('button', { name: 'Switch to light theme' });

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['theme'];
});

describe('ThemeSwitch', () => {
  it('names the theme it switches to, not the one in force', () => {
    render(<ThemeSwitch store={themeStoreHolding('dark')} />);
    expect(toLight()).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Switch to dark theme' })).toBeNull();
  });

  it('applies the remembered theme to the document', () => {
    render(<ThemeSwitch store={themeStoreHolding('dark')} />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('falls back to light when nothing has been chosen and the system says nothing', () => {
    render(<ThemeSwitch store={themeStoreHolding(null)} />);
    expect(toDark()).toBeDefined();
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('follows the system when nothing has been chosen', () => {
    vi.stubGlobal('matchMedia', systemPreferring(true).matchMedia);
    render(<ThemeSwitch store={themeStoreHolding(null)} />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(toLight()).toBeDefined();
  });

  it('switches the document over to dark, and then offers light', async () => {
    render(<ThemeSwitch store={themeStoreHolding('light')} />);
    await userEvent.click(toDark());
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(toLight()).toBeDefined();
  });

  it('switches back to light', async () => {
    render(<ThemeSwitch store={themeStoreHolding('dark')} />);
    await userEvent.click(toLight());
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(toDark()).toBeDefined();
  });

  it('remembers the choice for next time', async () => {
    const store = themeStoreHolding('light');
    render(<ThemeSwitch store={store} />);
    await userEvent.click(toDark());
    expect(store.written).toEqual(['dark']);
  });

  it('is one control, a button rather than a pair of radios', () => {
    render(<ThemeSwitch store={themeStoreHolding('light')} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  // A store that cannot keep a choice for next time still answers with it
  // for this session: that is the store's contract (theme.ts), and the
  // browser one is held to it in browser-theme-store.test.ts.
  it('follows the store, which is where the choice lives', async () => {
    const store = themeStoreHolding('light');
    render(<ThemeSwitch store={store} />);
    await userEvent.click(toDark());
    expect(store.read()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
