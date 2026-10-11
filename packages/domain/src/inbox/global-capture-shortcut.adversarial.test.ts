import { describe, expect, it } from 'vitest';
import { globalShortcutFromKeys, type ShortcutKeys } from './global-capture-shortcut.ts';

/**
 * #81 adversarial: the rule says a shortcut is refused when it "would take a
 * key from every app". A Carbon hot key (what the host registers) is handed to
 * Atlas before any other app sees the press, so these are taken from every
 * app as surely as a bare letter is.
 */
const press = (code: string, held: Partial<Omit<ShortcutKeys, 'code'>> = {}): ShortcutKeys => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
});

describe('a global capture shortcut that would take a key from every other app', () => {
  it('is refused when ⌥ is the only modifier on a letter or digit: on a Mac that types a character everywhere', () => {
    // ⌥E is the acute dead key (é), ⌥N the tilde (ñ), ⌥2 types ™, ⌥⇧K the Apple logo.
    for (const [code, held] of [
      ['KeyE', { altKey: true }],
      ['KeyN', { altKey: true }],
      ['Digit2', { altKey: true }],
      ['KeyK', { altKey: true, shiftKey: true }],
    ] as const) {
      expect(
        globalShortcutFromKeys(press(code, held)),
        `${code} ${JSON.stringify(held)}`,
      ).toHaveProperty('refused');
    }
  });

  it('is refused for ⌘C, ⌘V, ⌘X, ⌘Z and ⌘Q: copy, paste, cut, undo and quit in every app', () => {
    for (const code of ['KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyQ']) {
      expect(globalShortcutFromKeys(press(code, { metaKey: true })), code).toHaveProperty(
        'refused',
      );
    }
  });
});
