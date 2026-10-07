/**
 * The app's overlays, and the rule that only one is ever up.
 *
 * One value rather than a flag each: two overlays at once means two focus
 * traps fighting, and a flag left set under another overlay pops its own open
 * the moment that one closes.
 */
export type Overlay =
  | 'search'
  | 'capture'
  | 'settings'
  | 'new-type'
  | 'new-view'
  | 'new-artifact'
  | 'new-note-menu'
  | 'views-menu'
  | 'open-from-github'
  | 'template-delete'
  | 'template-to-note'
  | QuickAddOverlay
  | QueryPopupOverlay
  | PagesOverlay
  | PageMenuOverlay
  | PanePopupOverlay;

/**
 * What Pages puts up: a row's menu, the section's "+", the folder picker for a
 * move and the question before a delete.
 */
export type PagesOverlay = 'tree-menu' | 'pages-menu' | 'move-picker' | 'delete-dialog';

/**
 * The floating add button's speed dial, and its quick-add popover. Neither is
 * modal: each gives way to anything asked for over it, as a menu does.
 */
export type QuickAddOverlay = 'quick-add-menu' | 'quick-add';

/** A popup on the query page — Save as view, Add to dashboard — by its name. */
export type QueryPopupOverlay = `query-${string}`;

/** A pane's "…" menu. One per pane, told apart by the pane's index. */
export type PageMenuOverlay = `page-menu-${number}`;

export function pageMenuOverlay(pane: number): PageMenuOverlay {
  return `page-menu-${pane}`;
}

/** Any other popup a pane draws — a widget's "…", a view's Filter or Sort — by its name in the pane. */
export type PanePopupOverlay = `pane-${number}-${string}`;

export function panePopupOverlay(pane: number, name: string): PanePopupOverlay {
  return `pane-${pane}-${name}`;
}

/** The palettes, Settings, New type, and Pages' picker and delete question. Each is a modal dialog; a menu is not a place, only a choice. */
const MODAL: ReadonlySet<Overlay> = new Set([
  'search',
  'capture',
  'settings',
  'new-type',
  'new-view',
  'new-artifact',
  'move-picker',
  'delete-dialog',
  'template-delete',
  'template-to-note',
]);

/**
 * What is up once `requested` is asked for while `current` is.
 *
 * A palette holds the screen until it is closed: a shortcut for another overlay
 * pressed inside one is ignored rather than queued, since a queued one would
 * appear unasked later. A menu gives way, closing as the new overlay opens.
 */
export function openOverlay(current: Overlay | null, requested: Overlay): Overlay {
  if (current !== null && holdsTheScreen(current)) return current;
  return requested;
}

/**
 * Whether a palette or dialog is up. While one is, the window's shortcuts that
 * make or open a note — Cmd+N, Shift+Cmd+D, Alt+Cmd+N — do nothing, as a
 * shortcut for another overlay does: acting behind it makes a note the person
 * cannot see being made. Nothing is closed for them either; Escape first, then
 * the shortcut, is the same two presses and says which was meant.
 */
export function holdsTheScreen(current: Overlay | null): boolean {
  return current !== null && MODAL.has(current);
}

/**
 * What is up once `closing` closes. Only that overlay: one that reports closing
 * because another has just replaced it must not close its replacement.
 */
export function closeOverlay(current: Overlay | null, closing: Overlay): Overlay | null {
  return current === closing ? null : current;
}
