import { describe, expect, it } from 'vitest';
import {
  closeOverlay,
  holdsTheScreen,
  openOverlay,
  pageMenuOverlay,
  panePopupOverlay,
} from './overlay.ts';

describe('openOverlay', () => {
  it('opens what is asked for when nothing is up', () => {
    expect(openOverlay(null, 'search')).toBe('search');
    expect(openOverlay(null, 'capture')).toBe('capture');
    expect(openOverlay(null, 'new-note-menu')).toBe('new-note-menu');
  });

  it('closes the new-note menu as another overlay opens', () => {
    expect(openOverlay('new-note-menu', 'search')).toBe('search');
    expect(openOverlay('new-note-menu', 'capture')).toBe('capture');
  });

  it('leaves an open palette up, and queues nothing behind it', () => {
    expect(openOverlay('capture', 'search')).toBe('capture');
    expect(openOverlay('search', 'capture')).toBe('search');
    expect(openOverlay('search', 'new-note-menu')).toBe('search');
  });

  it('holds Settings up like a palette, and lets a palette hold it off', () => {
    expect(openOverlay(null, 'settings')).toBe('settings');
    expect(openOverlay('settings', 'search')).toBe('settings');
    expect(openOverlay('settings', 'capture')).toBe('settings');
    expect(openOverlay('search', 'settings')).toBe('search');
    expect(openOverlay('new-note-menu', 'settings')).toBe('settings');
  });

  it('lets a row menu give way to the move picker or the delete question it opens', () => {
    expect(openOverlay('tree-menu', 'move-picker')).toBe('move-picker');
    expect(openOverlay('tree-menu', 'delete-dialog')).toBe('delete-dialog');
    expect(openOverlay(pageMenuOverlay(0), 'delete-dialog')).toBe('delete-dialog');
  });

  it('holds the move picker and the delete question up like a palette', () => {
    expect(openOverlay('move-picker', 'search')).toBe('move-picker');
    expect(openOverlay('delete-dialog', 'tree-menu')).toBe('delete-dialog');
    expect(openOverlay('delete-dialog', 'pages-menu')).toBe('delete-dialog');
  });

  it('gives way with a page menu as it does with the new-note menu', () => {
    expect(openOverlay(null, pageMenuOverlay(0))).toBe('page-menu-0');
    expect(openOverlay(pageMenuOverlay(0), 'search')).toBe('search');
    expect(openOverlay('search', pageMenuOverlay(1))).toBe('search');
  });

  it('has one page menu up at a time, even across panes', () => {
    expect(openOverlay(pageMenuOverlay(0), pageMenuOverlay(1))).toBe('page-menu-1');
    expect(closeOverlay(pageMenuOverlay(1), pageMenuOverlay(0))).toBe('page-menu-1');
  });

  it('gives way with a pane popup, and tells popups apart by pane and name', () => {
    const filter = panePopupOverlay(0, 'filter');
    expect(openOverlay(filter, 'search')).toBe('search');
    expect(openOverlay('search', filter)).toBe('search');
    expect(openOverlay(filter, panePopupOverlay(1, 'filter'))).toBe('pane-1-filter');
    expect(closeOverlay(panePopupOverlay(0, 'sort'), filter)).toBe('pane-0-sort');
  });

  // The add button's dial gives way to its own popover, and both to a palette.
  it("lets the add button's dial and popover give way, as menus do", () => {
    expect(openOverlay('quick-add-menu', 'quick-add')).toBe('quick-add');
    expect(openOverlay('quick-add', 'search')).toBe('search');
    expect(openOverlay('capture', 'quick-add-menu')).toBe('capture');
    expect(closeOverlay('quick-add', 'quick-add-menu')).toBe('quick-add');
  });

  it('keeps a palette asked for again as it is', () => {
    expect(openOverlay('search', 'search')).toBe('search');
  });
});

describe('closeOverlay', () => {
  it('closes the overlay that is up', () => {
    expect(closeOverlay('search', 'search')).toBeNull();
    expect(closeOverlay('new-note-menu', 'new-note-menu')).toBeNull();
  });

  it('does not close an overlay that replaced the one closing', () => {
    expect(closeOverlay('search', 'new-note-menu')).toBe('search');
  });

  it('leaves nothing up as nothing', () => {
    expect(closeOverlay(null, 'capture')).toBeNull();
  });
});

describe('holdsTheScreen', () => {
  it('is true while a palette or dialog is up', () => {
    expect(holdsTheScreen('search')).toBe(true);
    expect(holdsTheScreen('capture')).toBe(true);
    expect(holdsTheScreen('settings')).toBe(true);
  });

  it('is false with nothing up, or only a menu or popover', () => {
    expect(holdsTheScreen(null)).toBe(false);
    expect(holdsTheScreen('new-note-menu')).toBe(false);
    expect(holdsTheScreen('quick-add')).toBe(false);
  });
});
