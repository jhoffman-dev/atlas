// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppShortcuts, type AppShortcuts } from './app-shortcuts.ts';
import type { Overlay } from './overlay.ts';

function listen(overlay: Overlay | null = null): AppShortcuts {
  const shortcuts: AppShortcuts = {
    overlay,
    save: vi.fn(),
    newNote: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleSplit: vi.fn(),
    dailyNote: vi.fn(),
    quickAdd: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    show: vi.fn(),
    toggleChat: vi.fn(),
  };
  renderHook(() => useAppShortcuts(shortcuts));
  return shortcuts;
}

const press = (init: KeyboardEventInit) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, altKey: true, ...init }));

describe('Alt+Cmd+N, the add button from the keyboard', () => {
  it('is found by the key in N’s place, where Alt turns it into a dead key', () => {
    const shortcuts = listen();
    press({ key: 'Dead', code: 'KeyN' });
    expect(shortcuts.quickAdd).toHaveBeenCalledTimes(1);
    expect(shortcuts.newNote).not.toHaveBeenCalled();
  });

  it('is found by the letter N on a layout that puts it elsewhere, as Dvorak does', () => {
    const shortcuts = listen();
    press({ key: 'n', code: 'KeyL' });
    expect(shortcuts.quickAdd).toHaveBeenCalledTimes(1);
    expect(shortcuts.newNote).not.toHaveBeenCalled();
  });

  it('is not Shift+Alt+Cmd+N, nor Alt+Cmd with another letter', () => {
    const shortcuts = listen();
    press({ key: 'N', code: 'KeyN', shiftKey: true });
    press({ key: 'b', code: 'KeyB' });
    expect(shortcuts.quickAdd).not.toHaveBeenCalled();
  });
});

describe('a shortcut that makes a note, pressed behind an open palette (A14-08)', () => {
  const chord = (init: KeyboardEventInit) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, ...init }));

  it.each(['search', 'capture', 'settings'] as const)('does nothing while %s is up', (overlay) => {
    const shortcuts = listen(overlay);
    chord({ key: 'n', code: 'KeyN' });
    chord({ key: 'D', code: 'KeyD', shiftKey: true });
    chord({ key: 'Dead', code: 'KeyN', altKey: true });
    expect(shortcuts.newNote).not.toHaveBeenCalled();
    expect(shortcuts.dailyNote).not.toHaveBeenCalled();
    expect(shortcuts.quickAdd).not.toHaveBeenCalled();
  });

  it('still acts with only a menu up, which gives way to it (control)', () => {
    const shortcuts = listen('new-note-menu');
    chord({ key: 'n', code: 'KeyN' });
    chord({ key: 'D', code: 'KeyD', shiftKey: true });
    chord({ key: 'Dead', code: 'KeyN', altKey: true });
    expect(shortcuts.newNote).toHaveBeenCalledTimes(1);
    expect(shortcuts.dailyNote).toHaveBeenCalledTimes(1);
    expect(shortcuts.quickAdd).toHaveBeenCalledTimes(1);
  });
});

describe('Cmd+J, Claude', () => {
  const cmd = (init: KeyboardEventInit) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, ...init }));

  it('opens and closes the chat', () => {
    const shortcuts = listen();
    cmd({ key: 'j' });
    expect(shortcuts.toggleChat).toHaveBeenCalledTimes(1);
  });

  it('is left alone while a dialog holds the screen, or with Shift or Alt held', () => {
    const shortcuts = listen('settings');
    cmd({ key: 'j' });
    expect(shortcuts.toggleChat).not.toHaveBeenCalled();
    const free = listen();
    cmd({ key: 'J', shiftKey: true });
    cmd({ key: 'j', altKey: true });
    expect(free.toggleChat).not.toHaveBeenCalled();
  });
});
