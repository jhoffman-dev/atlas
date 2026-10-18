import { useEffect, useRef } from 'react';
import { holdsTheScreen, type Overlay } from './overlay.ts';

/**
 * What Shift+Cmd+\ arrives as.
 *
 * Shift turns the backslash into a pipe on a US layout and leaves it alone on
 * others, and a shortcut that works on one keyboard is a shortcut that is
 * reported as broken from the other.
 */
const SPLIT_KEYS = new Set(['|', '\\']);

/** `MouseEvent.button` for a mouse's side buttons. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/** What the window's shortcuts do. */
export interface AppShortcuts {
  /** What is up at the key press: a palette or dialog holds the shortcuts that make a note. */
  readonly overlay: () => Overlay | null;
  readonly save: () => void;
  readonly newNote: () => void;
  readonly toggleSidebar: () => void;
  readonly toggleSplit: () => void;
  readonly dailyNote: () => void;
  /** The floating add button's own press: Alt+Cmd+N. */
  readonly quickAdd: () => void;
  /** Back and Forward in the pane being worked in. */
  readonly back: () => void;
  readonly forward: () => void;
  /** The tabs of the pane being worked in (tab-model.md): ⌘T, ⌘W, ⌃Tab, ⌃⇧Tab, ⌘1–9, ⌘⇧T. */
  readonly tabs: TabShortcuts;
  /** Puts up one of the window's overlays. */
  readonly show: (overlay: Overlay) => void;
  /** Opens or closes Claude, beside the work. */
  readonly toggleChat: () => void;
}

export interface TabShortcuts {
  readonly newTab: () => void;
  /** Closes the shown tab, and never the window: that is what ⌘W means in an app with tabs. */
  readonly closeTab: () => void;
  readonly nextTab: () => void;
  readonly previousTab: () => void;
  /** Shows the nth tab, counting from 1; 9 is the last. */
  readonly nthTab: (n: number) => void;
  readonly reopenClosedTab: () => void;
}

/**
 * The tab shortcuts, as browsers have them. ⌘W is taken whether or not a
 * dialog is up, and always prevented: left to the host it would close the
 * window, which no tab should. The rest are left alone behind a dialog, as
 * Back and Forward are. ⌃Tab is Ctrl everywhere; T, W and the numbers take
 * ⌘ alone on a Mac — ⌃T there is the text system's transpose, which an
 * editor must keep — and Ctrl alone off one.
 */
function onTabKey(
  event: KeyboardEvent,
  tabs: TabShortcuts,
  { held, onMac }: { held: boolean; onMac: boolean },
): void {
  const command = onMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    if (!held) tabs.closeTab();
    return;
  }
  if (command && !event.altKey && event.key.toLowerCase() === 't') {
    event.preventDefault();
    if (held) return;
    if (event.shiftKey) tabs.reopenClosedTab();
    else tabs.newTab();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
    event.preventDefault();
    if (held) return;
    if (event.shiftKey) tabs.previousTab();
    else tabs.nextTab();
    return;
  }
  if (command && !event.shiftKey && !event.altKey && /^[1-9]$/.test(event.key)) {
    event.preventDefault();
    if (!held) tabs.nthTab(Number(event.key));
  }
}

/**
 * Whether this is a Mac, where the command key is ⌘ and ⌃ belongs to the
 * text system (⌃T transposes two letters). Read once from the host's
 * platform string; off a Mac, Ctrl is the command key.
 */
export function runsOnMac(platform: string = navigator.platform): boolean {
  return /^Mac|^iP/.test(platform);
}

/** The window's keyboard shortcuts, listened for as long as the app is open. */
export function useAppShortcuts(
  shortcuts: AppShortcuts,
  { onMac = runsOnMac() }: { onMac?: boolean } = {},
): void {
  // Listened for once; each key reaches what the latest render handed in.
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });
  // Cmd+S saves and Cmd+K searches, as they do everywhere else on this machine.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { save, newNote, toggleSidebar, toggleSplit, dailyNote, show } = latest.current;
      const held = holdsTheScreen(latest.current.overlay());
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        show('search');
      }
      // Shift excluded, or Shift+Cmd+N would make a blank note as well as
      // opening capture — and the two creations would race each other.
      // Alt excluded, or Alt+Cmd+N would make a blank note as well as adding one.
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'n'
      ) {
        event.preventDefault();
        if (!held) newNote();
      }
      // Alt+Cmd+N: what the floating add button does. Matched by the key's
      // place, since Alt turns N into a dead key on a Mac layout, or by the
      // letter, for a layout (Dvorak) that puts N somewhere else.
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        !event.shiftKey &&
        (event.code === 'KeyN' || event.key.toLowerCase() === 'n')
      ) {
        event.preventDefault();
        if (!held) latest.current.quickAdd();
      }
      // Shift excluded: Shift+Cmd+\ splits, and Cmd+\ has shut the sidebar
      // since long before there was a split to bind it to.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === '\\') {
        event.preventDefault();
        if (!held) toggleSidebar();
      }
      // Shift+Cmd+\ splits the window, and closes the pane you are in once it
      // is split — one key going both ways, as Cmd+\ does for the sidebar. The
      // key reads as a pipe while Shift is down on most layouts.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && SPLIT_KEYS.has(event.key)) {
        event.preventDefault();
        if (!held) toggleSplit();
      }
      // Shift+Cmd+N: a line of text becomes a task, without leaving what you
      // were doing. Cmd+N still makes a blank note in the folder in view.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        show('capture');
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (!held) dailyNote();
      }
      // Cmd+J opens and closes Claude, as it asks Notion's AI. Not while a
      // dialog holds the screen: the chat opens beside the work, not over it.
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'j'
      ) {
        event.preventDefault();
        if (!held) latest.current.toggleChat();
      }
      // Cmd+, opens Settings, as it does in every Mac app.
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        show('settings');
      }
      // Cmd+[ and Cmd+] go back and forward, as in Safari, Finder and Notion.
      // Not behind a dialog, as the sidebar and the split are not changed
      // behind one: what moves is what the person cannot see (#266).
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === '[') {
        event.preventDefault();
        if (!held) latest.current.back();
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === ']') {
        event.preventDefault();
        if (!held) latest.current.forward();
      }
      onTabKey(event, latest.current.tabs, { held, onMac });
    };
    // A mouse's own back and forward buttons do the same.
    const onMouseUp = (event: MouseEvent) => {
      if (holdsTheScreen(latest.current.overlay())) return;
      if (event.button === MOUSE_BACK) latest.current.back();
      if (event.button === MOUSE_FORWARD) latest.current.forward();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMac]);
}
