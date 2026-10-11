import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL_CAPTURE_SHORTCUT,
  globalShortcutFromKeys,
  globalShortcutLabel,
  type ShortcutKeys,
} from './global-capture-shortcut.ts';

/** #81: the system-wide quick capture shortcut, as Settings records it and the host registers it. */
const press = (code: string, held: Partial<Omit<ShortcutKeys, 'code'>> = {}): ShortcutKeys => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
});

describe('a global capture shortcut from a key press', () => {
  it('is written modifiers first, in menu order, then the key by its place', () => {
    expect(globalShortcutFromKeys(press('KeyN', { ctrlKey: true, altKey: true }))).toEqual({
      shortcut: 'Control+Alt+KeyN',
    });
    expect(
      globalShortcutFromKeys(press('Space', { metaKey: true, shiftKey: true, altKey: true })),
    ).toEqual({ shortcut: 'Alt+Shift+Super+Space' });
    expect(globalShortcutFromKeys(press('F5', { metaKey: true }))).toEqual({
      shortcut: 'Super+F5',
    });
  });

  it('is refused without ⌘, ⌥ or ⌃, which would take the key from every other app', () => {
    const alone = globalShortcutFromKeys(press('KeyN'));
    expect(alone).toEqual({
      refused: expect.stringMatching(/^Hold ⌘, ⌥ or ⌃ with it: on its own, N/),
    });
    // Shift alone still types a capital letter everywhere else.
    expect(globalShortcutFromKeys(press('KeyN', { shiftKey: true }))).toHaveProperty('refused');
    for (const held of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(globalShortcutFromKeys(press('KeyN', held))).toHaveProperty('shortcut');
    }
  });

  it('waits for a key while only modifiers are down, and refuses a key the host cannot register', () => {
    for (const code of ['MetaLeft', 'ControlLeft', 'AltRight', 'ShiftLeft', 'IntlBackslash', '']) {
      expect(globalShortcutFromKeys(press(code, { metaKey: true }))).toEqual({
        refused: 'Hold ⌘, ⌥ or ⌃ and press a letter, a digit, a function key or Space.',
      });
    }
    expect(globalShortcutFromKeys(press('F25', { metaKey: true }))).toHaveProperty('refused');
    expect(globalShortcutFromKeys(press('Digit7', { metaKey: true }))).toEqual({
      shortcut: 'Super+Digit7',
    });
  });
});

describe('a global capture shortcut as Settings shows it', () => {
  it('reads as a Mac menu writes it', () => {
    expect(globalShortcutLabel('Control+Alt+KeyN')).toBe('⌃⌥N');
    expect(globalShortcutLabel('Alt+Shift+Super+Space')).toBe('⌥⇧⌘Space');
    expect(globalShortcutLabel('Super+Digit7')).toBe('⌘7');
    expect(globalShortcutLabel('Control+ArrowUp')).toBe('⌃↑');
  });

  it('puts the symbols in menu order, however the shortcut was written', () => {
    expect(globalShortcutLabel('Super+Control+KeyK')).toBe('⌃⌘K');
  });

  it('is shown as written when it cannot be read', () => {
    expect(globalShortcutLabel('Hyper+KeyN')).toBe('Hyper+KeyN');
    expect(globalShortcutLabel('Control+Pause')).toBe('Control+Pause');
  });

  it('defaults to ⌃⌥N', () => {
    expect(globalShortcutLabel(DEFAULT_GLOBAL_CAPTURE_SHORTCUT)).toBe('⌃⌥N');
  });
});
