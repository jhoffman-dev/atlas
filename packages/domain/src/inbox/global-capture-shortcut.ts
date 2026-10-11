/**
 * The system-wide shortcut that brings Atlas forward with quick capture open,
 * whatever app has the keyboard (#81).
 *
 * It is written as the host registers it, modifiers first and then the key by
 * its place on the keyboard: `Control+Alt+KeyN`. By place rather than by
 * letter, because Alt turns a letter into a dead key on a Mac layout.
 */

/** ⌃⌥N: unused by macOS and by the apps Atlas sits beside, and close to ⌥⌘N, the add button. */
export const DEFAULT_GLOBAL_CAPTURE_SHORTCUT = 'Control+Alt+KeyN';

/** The modifiers, in the order a Mac menu shows them and the shortcut is written. */
const MODIFIERS = [
  { name: 'Control', symbol: '⌃', held: (keys: ShortcutKeys) => keys.ctrlKey },
  { name: 'Alt', symbol: '⌥', held: (keys: ShortcutKeys) => keys.altKey },
  { name: 'Shift', symbol: '⇧', held: (keys: ShortcutKeys) => keys.shiftKey },
  { name: 'Super', symbol: '⌘', held: (keys: ShortcutKeys) => keys.metaKey },
] as const;

/**
 * A global shortcut reaches Atlas before any other app sees the press, so it
 * holds two of these. One alone is how every app copies (⌘C), quits (⌘Q) and
 * types (⌥E is é); Shift adds nothing, since ⇧ is typing too.
 */
const CLAIMING_MODIFIERS: ReadonlySet<string> = new Set(['Control', 'Alt', 'Super']);
const CLAIMING_NEEDED = 2;

/**
 * macOS's own shortcuts that hold two of them, which a global shortcut would
 * take from macOS: what each does, by the shortcut as it is written.
 */
const SYSTEM_SHORTCUTS: ReadonlyMap<string, string> = new Map([
  ['Control+Super+KeyQ', 'Lock Screen'],
  ['Control+Super+Space', 'the emoji picker'],
  ['Alt+Super+Escape', 'Force Quit'],
  ['Control+Super+KeyF', 'full screen'],
  ['Alt+Super+Space', 'the Finder search window'],
  ['Alt+Super+KeyD', 'hiding the Dock'],
]);

/** Keys a shortcut can end in that are not a letter, a digit or a function key, by `KeyboardEvent.code`. */
const NAMED_KEYS: ReadonlyMap<string, string> = new Map([
  ['Space', 'Space'],
  ['Enter', '↩'],
  ['Tab', '⇥'],
  ['Backspace', '⌫'],
  ['Delete', '⌦'],
  ['Escape', '⎋'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['Home', '↖'],
  ['End', '↘'],
  ['PageUp', '⇞'],
  ['PageDown', '⇟'],
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['Backquote', '`'],
]);

const LETTER_OR_DIGIT = /^(?:Key[A-Z]|Digit[0-9])$/;
/** F1 to F20: a Mac keyboard has no key code for F21 and up, so the host cannot register them. */
const FUNCTION_KEY = /^F(?:[1-9]|1[0-9]|20)$/;

/** A key press, as the shortcut field hears it. */
export interface ShortcutKeys {
  /** `KeyboardEvent.code`: the key's place, whatever the layout prints on it. */
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** A press read as a shortcut, or what is wrong with it, in the words Settings shows. */
export type ShortcutReading = { readonly shortcut: string } | { readonly refused: string };

/**
 * A key press as a global shortcut — or, while only modifiers are down, or
 * the press would take a key from every app or from macOS, why not.
 */
export function globalShortcutFromKeys(keys: ShortcutKeys): ShortcutReading {
  if (!isShortcutKey(keys.code)) {
    return {
      refused: 'Hold two of ⌘, ⌥ and ⌃ and press a letter, a digit, a function key or Space.',
    };
  }
  const held = MODIFIERS.filter((modifier) => modifier.held(keys)).map(({ name }) => name);
  const shortcut = [...held, keys.code].join('+');
  const claiming = held.filter((name) => CLAIMING_MODIFIERS.has(name)).length;
  if (claiming < CLAIMING_NEEDED) {
    return {
      refused: `Hold two of ⌘, ⌥ and ⌃: ${globalShortcutLabel(shortcut)} would stop working in every other app.`,
    };
  }
  const system = SYSTEM_SHORTCUTS.get(shortcut);
  if (system !== undefined) {
    return {
      refused: `${globalShortcutLabel(shortcut)} is macOS's own, for ${system}: choose another.`,
    };
  }
  return { shortcut };
}

/** `Control+Alt+KeyN` as a Mac menu writes it: ⌃⌥N. A shortcut it cannot read is shown as written. */
export function globalShortcutLabel(shortcut: string): string {
  const parts = shortcut.split('+');
  const code = parts.at(-1) ?? '';
  const names = new Set(parts.slice(0, -1));
  const known = names.size === parts.length - 1 && [...names].every(isModifierName);
  if (!known || !isShortcutKey(code)) return shortcut;
  const symbols = MODIFIERS.filter(({ name }) => names.has(name)).map(({ symbol }) => symbol);
  return `${symbols.join('')}${keyLabel(code)}`;
}

function isModifierName(name: string): boolean {
  return MODIFIERS.some((modifier) => modifier.name === name);
}

function isShortcutKey(code: string): boolean {
  return LETTER_OR_DIGIT.test(code) || FUNCTION_KEY.test(code) || NAMED_KEYS.has(code);
}

/** `KeyN` → N, `Digit4` → 4, `Space` → Space, `F5` → F5. */
function keyLabel(code: string): string {
  if (LETTER_OR_DIGIT.test(code)) return code.slice(-1);
  return NAMED_KEYS.get(code) ?? code;
}
