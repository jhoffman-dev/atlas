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
      globalShortcutFromKeys(press('KeyK', { metaKey: true, shiftKey: true, altKey: true })),
    ).toEqual({ shortcut: 'Alt+Shift+Super+KeyK' });
    expect(globalShortcutFromKeys(press('F5', { metaKey: true, ctrlKey: true }))).toEqual({
      shortcut: 'Control+Super+F5',
    });
  });

  // Changed with the review of #81: one of ⌘, ⌥ and ⌃ used to be enough. A
  // global shortcut beats every app, so ⌥N (ñ), ⌘C and ⌃N are now refused.
  it('needs two of ⌘, ⌥ and ⌃: one alone, or with Shift, would take the key from every other app', () => {
    expect(globalShortcutFromKeys(press('KeyN'))).toEqual({
      refused: 'Hold two of ⌘, ⌥ and ⌃: N would stop working in every other app.',
    });
    for (const held of [
      { shiftKey: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { metaKey: true, shiftKey: true },
      { altKey: true, shiftKey: true },
    ]) {
      expect(globalShortcutFromKeys(press('KeyN', held)), JSON.stringify(held)).toHaveProperty(
        'refused',
      );
    }
    for (const held of [
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, metaKey: true },
      { altKey: true, metaKey: true },
      { ctrlKey: true, altKey: true, metaKey: true },
    ]) {
      expect(globalShortcutFromKeys(press('KeyN', held)), JSON.stringify(held)).toHaveProperty(
        'shortcut',
      );
    }
  });

  it("refuses macOS's own shortcuts that hold two of them, and says what each is for", () => {
    expect(globalShortcutFromKeys(press('KeyQ', { ctrlKey: true, metaKey: true }))).toEqual({
      refused: "⌃⌘Q is macOS's own, for Lock Screen: choose another.",
    });
    for (const [code, held] of [
      ['Space', { ctrlKey: true, metaKey: true }],
      ['Escape', { altKey: true, metaKey: true }],
      ['KeyF', { ctrlKey: true, metaKey: true }],
      ['Space', { altKey: true, metaKey: true }],
      ['KeyD', { altKey: true, metaKey: true }],
    ] as const) {
      expect(globalShortcutFromKeys(press(code, held)), code).toEqual({
        refused: expect.stringMatching(/is macOS's own, for /),
      });
    }
    // The same key with other modifiers is not macOS's.
    expect(
      globalShortcutFromKeys(press('KeyQ', { ctrlKey: true, metaKey: true, shiftKey: true })),
    ).toHaveProperty('shortcut');
  });

  it('waits for a key while only modifiers are down, and refuses a key the host cannot register', () => {
    const two = { metaKey: true, ctrlKey: true };
    for (const code of ['MetaLeft', 'ControlLeft', 'AltRight', 'ShiftLeft', 'IntlBackslash', '']) {
      expect(globalShortcutFromKeys(press(code, two))).toEqual({
        refused: 'Hold two of ⌘, ⌥ and ⌃ and press a letter, a digit, a function key or Space.',
      });
    }
    // A Mac keyboard has no key code past F20.
    for (const code of ['F21', 'F24', 'F25']) {
      expect(globalShortcutFromKeys(press(code, two)), code).toHaveProperty('refused');
    }
    expect(globalShortcutFromKeys(press('F20', two))).toEqual({ shortcut: 'Control+Super+F20' });
    expect(globalShortcutFromKeys(press('Digit7', two))).toEqual({
      shortcut: 'Control+Super+Digit7',
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
