// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSwitch } from './theme-switch.tsx';
import type { Theme, ThemeStore } from './theme.ts';

/** A store that remembers, standing in for `localStorage`. */
const storeHolding = (initial: Theme | null): ThemeStore & { written: Theme[] } => {
  let held = initial;
  const written: Theme[] = [];
  return {
    written,
    read: () => held,
    write: (theme) => {
      held = theme;
      written.push(theme);
    },
  };
};

/** The one button, named for the theme it would switch to. */
const toDark = () => screen.getByRole('button', { name: 'Switch to dark theme' });
const toLight = () => screen.getByRole('button', { name: 'Switch to light theme' });

afterEach(() => {
  delete document.documentElement.dataset['theme'];
});

describe('ThemeSwitch', () => {
  it('names the theme it switches to, not the one in force', () => {
    render(<ThemeSwitch store={storeHolding('dark')} />);
    expect(toLight()).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Switch to dark theme' })).toBeNull();
  });

  it('applies the remembered theme to the document', () => {
    render(<ThemeSwitch store={storeHolding('dark')} />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('falls back to light when nothing has been chosen and the system says nothing', () => {
    render(<ThemeSwitch store={storeHolding(null)} />);
    expect(toDark()).toBeDefined();
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('follows the system when nothing has been chosen', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    render(<ThemeSwitch store={storeHolding(null)} />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(toLight()).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('switches the document over to dark, and then offers light', async () => {
    render(<ThemeSwitch store={storeHolding('light')} />);
    await userEvent.click(toDark());
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(toLight()).toBeDefined();
  });

  it('switches back to light', async () => {
    render(<ThemeSwitch store={storeHolding('dark')} />);
    await userEvent.click(toLight());
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(toDark()).toBeDefined();
  });

  it('remembers the choice for next time', async () => {
    const store = storeHolding('light');
    render(<ThemeSwitch store={store} />);
    await userEvent.click(toDark());
    expect(store.written).toEqual(['dark']);
  });

  it('is one control, a button rather than a pair of radios', () => {
    render(<ThemeSwitch store={storeHolding('light')} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  // A store that cannot remember — a private window, say — reads as "nothing
  // chosen", which is the same case as a first run. Keeping the storage failure
  // inside the adapter is what lets this component stay this simple; the
  // guarding itself is tested in browser-theme-store.test.ts.
  it('still switches the theme when the store cannot remember anything', async () => {
    const forgetful: ThemeStore = { read: () => null, write: () => {} };
    render(<ThemeSwitch store={forgetful} />);
    await userEvent.click(toDark());
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
