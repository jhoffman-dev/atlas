import { createContext, useContext, type ReactNode } from 'react';
import { Icon } from '../icon.tsx';

/** Whether the right sidebar is on screen, and the way to show or hide it. */
export interface AsideToggle {
  /**
   * Shown: open by the viewer's choice and not folded by a narrow window.
   * The button's pressed state says what is on screen, not what is remembered.
   */
  readonly shown: boolean;
  readonly onToggle: () => void;
}

const AsideToggleContext = createContext<AsideToggle | null>(null);

/**
 * Hands the right sidebar's switch to every page's bar at once, as the
 * chat's is: every surface draws its own bar, and none should carry the aside
 * through its props.
 */
export const AsideToggleProvider = AsideToggleContext.Provider;

/** The switch as handed down, or null where the app offers no right sidebar. */
export function useAsideToggle(): AsideToggle | null {
  return useContext(AsideToggleContext);
}

/** The right sidebar's button in a page's bar, drawn by `PageBarToggles` as the chat's is. */
export function asideToggleButton(toggle: AsideToggle): ReactNode {
  return (
    <button
      className="icon-button page-bar__button page-bar__aside"
      type="button"
      aria-label="Right sidebar"
      aria-pressed={toggle.shown}
      title={toggle.shown ? 'Hide right sidebar (⌥⌘\\)' : 'Show right sidebar (⌥⌘\\)'}
      onClick={toggle.onToggle}
    >
      <Icon name="panel" size={15} className="page-bar__aside-glyph" />
    </button>
  );
}
