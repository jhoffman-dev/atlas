// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppShortcuts, type AppShortcuts } from './app-shortcuts.ts';
import type { Overlay } from './overlay.ts';

function listen(overlay: Overlay | null = null): AppShortcuts {
  return listenTo(() => overlay);
}

/** The shortcuts, reading what is up from `overlay` at each key press. */
function listenTo(overlay: () => Overlay | null): AppShortcuts {
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
    tabs: {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      nextTab: vi.fn(),
      previousTab: vi.fn(),
      nthTab: vi.fn(),
      reopenClosedTab: vi.fn(),
    },
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

  it('does nothing behind a palette opened since the window last drew (#261)', () => {
    let up: Overlay | null = null;
    const shortcuts = listenTo(() => up);
    // ⌘K opens from the store; the window is not drawn again to hand it over.
    up = 'search';
    chord({ key: 'n', code: 'KeyN' });
    expect(shortcuts.newNote).not.toHaveBeenCalled();
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

describe('the shortcuts that change the window, behind a dialog (#266)', () => {
  const chord = (init: KeyboardEventInit) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, ...init }));
  const mouseButton = (button: number) =>
    window.dispatchEvent(new MouseEvent('mouseup', { button }));

  /** Every window-changing key, and the mouse's back and forward buttons. */
  function pressAll(): void {
    chord({ key: '[' });
    chord({ key: ']' });
    chord({ key: '\\' });
    chord({ key: '|', shiftKey: true });
    mouseButton(3);
    mouseButton(4);
  }

  it.each(['search', 'capture', 'settings'] as const)('do nothing while %s is up', (overlay) => {
    const shortcuts = listen(overlay);
    pressAll();
    expect(shortcuts.back).not.toHaveBeenCalled();
    expect(shortcuts.forward).not.toHaveBeenCalled();
    expect(shortcuts.toggleSidebar).not.toHaveBeenCalled();
    expect(shortcuts.toggleSplit).not.toHaveBeenCalled();
  });

  it('act with nothing up, or only a menu (control)', () => {
    for (const overlay of [null, 'new-note-menu'] as const) {
      const shortcuts = listen(overlay);
      pressAll();
      expect(shortcuts.back).toHaveBeenCalledTimes(2);
      expect(shortcuts.forward).toHaveBeenCalledTimes(2);
      expect(shortcuts.toggleSidebar).toHaveBeenCalledTimes(1);
      expect(shortcuts.toggleSplit).toHaveBeenCalledTimes(1);
    }
  });
});

describe('the tab shortcuts (tab-model.md)', () => {
  const chord = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
  };

  it('opens a tab with ⌘T, reopens the last closed with ⌘⇧T, and closes with ⌘W', () => {
    const { tabs } = listen();
    chord({ metaKey: true, key: 't' });
    expect(tabs.newTab).toHaveBeenCalledTimes(1);
    chord({ metaKey: true, shiftKey: true, key: 'T' });
    expect(tabs.reopenClosedTab).toHaveBeenCalledTimes(1);
    expect(tabs.newTab).toHaveBeenCalledTimes(1);
    const close = chord({ metaKey: true, key: 'w' });
    expect(tabs.closeTab).toHaveBeenCalledTimes(1);
    // Never left to the host, which would close the window.
    expect(close.defaultPrevented).toBe(true);
  });

  it('walks the tabs with ⌃Tab and ⌃⇧Tab, and numbers them with ⌘1–9', () => {
    const { tabs } = listen();
    chord({ ctrlKey: true, key: 'Tab' });
    expect(tabs.nextTab).toHaveBeenCalledTimes(1);
    chord({ ctrlKey: true, shiftKey: true, key: 'Tab' });
    expect(tabs.previousTab).toHaveBeenCalledTimes(1);
    chord({ metaKey: true, key: '3' });
    chord({ metaKey: true, key: '9' });
    expect(vi.mocked(tabs.nthTab).mock.calls).toEqual([[3], [9]]);
    chord({ metaKey: true, key: '0' });
    chord({ metaKey: true, shiftKey: true, key: '3' });
    expect(tabs.nthTab).toHaveBeenCalledTimes(2);
  });

  it('keeps ⌘W from the host behind a dialog too, closing no tab there', () => {
    const { tabs } = listen('settings');
    const close = chord({ metaKey: true, key: 'w' });
    expect(close.defaultPrevented).toBe(true);
    expect(tabs.closeTab).not.toHaveBeenCalled();
    chord({ metaKey: true, key: 't' });
    chord({ ctrlKey: true, key: 'Tab' });
    chord({ metaKey: true, key: '2' });
    expect(tabs.newTab).not.toHaveBeenCalled();
    expect(tabs.nextTab).not.toHaveBeenCalled();
    expect(tabs.nthTab).not.toHaveBeenCalled();
  });

  it('leaves Tab alone without Ctrl, and ⌘T alone with Alt', () => {
    const { tabs } = listen();
    chord({ key: 'Tab' });
    chord({ metaKey: true, altKey: true, key: 't' });
    expect(tabs.nextTab).not.toHaveBeenCalled();
    expect(tabs.newTab).not.toHaveBeenCalled();
  });
});
