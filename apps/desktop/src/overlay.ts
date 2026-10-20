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

/**
 * A table cell's picker — a status's options, a relation's notes (#300) — by
 * its name among the pane's popups: one per pane, as only one cell edits.
 */
export const CELL_PICKER = 'cell-picker';

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

/** What is typed into the search palette, and which result is chosen. */
export interface PaletteInput {
  readonly query: string;
  /** The chosen row, counting the commands first and then the notes. */
  readonly selected: number;
  /** Archived notes are left out of a search unless this is on (U-22). */
  readonly includeArchived: boolean;
}

export const NO_INPUT: PaletteInput = { query: '', selected: 0, includeArchived: false };

/** The window's overlay state: which one is up, and what the search palette holds. */
export interface OverlayState {
  readonly overlay: Overlay | null;
  readonly palette: PaletteInput;
}

export const NO_OVERLAY: OverlayState = { overlay: null, palette: NO_INPUT };

/** `requested` asked for, by `openOverlay`'s rule. */
export function withOpened(state: OverlayState, requested: Overlay): OverlayState {
  return { ...state, overlay: openOverlay(state.overlay, requested) };
}

/**
 * `closing` closed, by `closeOverlay`'s rule. The search palette closed forgets
 * what was typed into it, however it closed: it opens empty the next time.
 */
export function withClosed(state: OverlayState, closing: Overlay): OverlayState {
  const overlay = closeOverlay(state.overlay, closing);
  const paletteClosed = state.overlay === 'search' && overlay !== 'search';
  return { overlay, palette: paletteClosed ? NO_INPUT : state.palette };
}

/**
 * The overlay the window draws itself: any but the search palette, which
 * watches for itself, so that opening it and typing into it draws nothing
 * else (#261).
 */
export function drawnByWindow(state: OverlayState): Overlay | null {
  return state.overlay === 'search' ? null : state.overlay;
}

/** A new query, with the first result chosen. */
export function withQuery(input: PaletteInput, query: string): PaletteInput {
  return { ...input, query, selected: 0 };
}

/** Archived notes let in or left out, with the first result chosen. */
export function withArchived(input: PaletteInput, includeArchived: boolean): PaletteInput {
  return { ...input, includeArchived, selected: 0 };
}

/** The choice moved `delta` rows through `count`, wrapping at either end. */
export function withMoved(input: PaletteInput, delta: number, count: number): PaletteInput {
  return { ...input, selected: count === 0 ? 0 : (input.selected + delta + count) % count };
}

/** The overlay a pane draws itself — its "…" menu or one of its popups — or null while none of its own is up. */
export function paneOverlayOf(overlay: Overlay | null, pane: number): Overlay | null {
  if (overlay === null) return null;
  return overlay === pageMenuOverlay(pane) || overlay.startsWith(`pane-${pane}-`) ? overlay : null;
}
