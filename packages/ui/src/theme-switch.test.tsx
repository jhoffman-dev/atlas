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

afterEach(() => {
  delete document.documentElement.dataset['theme'];
});

describe('ThemeSwitch', () => {
  it('starts on the theme that was remembered', () => {
    render(<ThemeSwitch store={storeHolding('dark')} />);
    expect(screen.getByRole('radio', { name: 'Dark theme' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('applies the remembered theme to the document', () => {
    render(<ThemeSwitch store={storeHolding('dark')} />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('falls back to light when nothing has been chosen and the system says nothing', () => {
    render(<ThemeSwitch store={storeHolding(null)} />);
    expect(screen.getByRole('radio', { name: 'Light theme' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('follows the system when nothing has been chosen', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    render(<ThemeSwitch store={storeHolding(null)} />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('switches the document over when dark is chosen', async () => {
    render(<ThemeSwitch store={storeHolding('light')} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('switches back to light', async () => {
    render(<ThemeSwitch store={storeHolding('dark')} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Light theme' }));
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('remembers the choice for next time', async () => {
    const store = storeHolding('light');
    render(<ThemeSwitch store={store} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));
    expect(store.written).toEqual(['dark']);
  });

  // A store that cannot remember — a private window, say — reads as "nothing
  // chosen", which is the same case as a first run. Keeping the storage failure
  // inside the adapter is what lets this component stay this simple; the
  // guarding itself is tested in browser-theme-store.test.ts.
  it('still switches the theme when the store cannot remember anything', async () => {
    const forgetful: ThemeStore = { read: () => null, write: () => {} };
    render(<ThemeSwitch store={forgetful} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
