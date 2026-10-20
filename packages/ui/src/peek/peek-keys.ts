/** A key press as the peek reads it: the key and what was held with it. */
export interface PeekKeyPress {
  readonly key: string;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  /** Held down: the system's auto-repeat, not a press of its own. */
  readonly repeat?: boolean;
}

/**
 * Where in the peek a key was pressed: the note's text (`body`), a form
 * control whose arrows change its own value (`field`), or the peek's own
 * chrome — its header, the properties strip's buttons, its foot.
 */
export type PeekKeyPlace = 'body' | 'field' | 'chrome';

export type PeekKeyAction =
  | { readonly kind: 'step'; readonly by: -1 | 1 }
  | { readonly kind: 'open'; readonly how: 'tab' | 'split' };

/** Where the row the peek shows sits in the list it was opened from. */
export interface PeekRowAt {
  readonly index: number;
  readonly count: number;
}

const ARROWS: Readonly<Record<string, -1 | 1>> = { ArrowUp: -1, ArrowDown: 1 };

/**
 * What a key does in the peek (Q6, James 2026-10-18).
 *
 * ↑ and ↓ step through the rows only from the chrome: in the body they move
 * the caret, in a field they change its value. ⌥↑ and ⌥↓ step from anywhere,
 * since ⌘↑ and ⌘↓ already mean the start and end of the document. ⌘↵ and
 * ⌘⇧↵ open the note in a tab or a split, except in the body, where the
 * editor already owns them (open the link under the caret, make the line a
 * task). Everything else — ⌘K first of all — is not the peek's to answer.
 *
 * A held ⌘↵ opens one tab, not one per auto-repeat. A held ↓ keeps stepping,
 * as a held arrow keeps moving down a list.
 */
export function peekKeyAction(press: PeekKeyPress, place: PeekKeyPlace): PeekKeyAction | null {
  const by = ARROWS[press.key];
  if (by !== undefined) return arrowAction(press, place, by);
  if (press.key === 'Enter' && press.metaKey && !press.altKey && !press.ctrlKey) {
    if (place === 'body' || press.repeat === true) return null;
    return { kind: 'open', how: press.shiftKey ? 'split' : 'tab' };
  }
  return null;
}

function arrowAction(press: PeekKeyPress, place: PeekKeyPlace, by: -1 | 1): PeekKeyAction | null {
  if (press.metaKey || press.ctrlKey || press.shiftKey) return null;
  if (press.altKey || place === 'chrome') return { kind: 'step', by };
  return null;
}

/**
 * The widgets that move something of their own on an arrow key — a choice, a
 * value, a highlighted item — by their ARIA role.
 */
const OWNS_ARROWS = [
  'combobox',
  'grid',
  'gridcell',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treegrid',
  'treeitem',
]
  .map((role) => `[role="${role}"]`)
  .join(', ');

/** Where a key press landed, from the element it was pressed in. */
export function peekKeyPlace(target: EventTarget | null): PeekKeyPlace {
  if (!(target instanceof HTMLElement)) return 'chrome';
  // `closest` rather than `isContentEditable`, which jsdom does not draw.
  if (target.closest('[contenteditable]:not([contenteditable="false"])') !== null) return 'body';
  const field =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest(OWNS_ARROWS) !== null;
  return field ? 'field' : 'chrome';
}

/**
 * The row one step away, or null past either end of the list. A row the list
 * no longer reaches (it shrank while the peek was open) steps back to its
 * last row, and no further on.
 */
export function steppedIndex(at: PeekRowAt, by: -1 | 1): number | null {
  if (at.index >= at.count) return by === -1 && at.count > 0 ? at.count - 1 : null;
  const next = at.index + by;
  return next < 0 || next >= at.count ? null : next;
}

/** "3 of 186 in Task table"; never a row past the end of a list that shrank. */
export function peekWhere(at: PeekRowAt & { readonly within: string }): string {
  if (at.index >= at.count) return `${at.count} ${at.count === 1 ? 'row' : 'rows'} in ${at.within}`;
  return `${at.index + 1} of ${at.count} in ${at.within}`;
}
