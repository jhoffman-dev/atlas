import type { ReactNode } from 'react';
import { Icon } from './icon.tsx';

/**
 * The window: the sidebar sitting straight on the ground colour, and the work
 * in raised, rounded panels beside it — one panel, or one per pane when the
 * window is split.
 */
export function AppShell({
  sidebar,
  main = null,
  notices = null,
  panes = [],
  status = null,
  overlay = null,
  floating = null,
  sidebarOpen = true,
  onShowSidebar,
  aside = null,
}: {
  sidebar: ReactNode;
  /**
   * A surface that takes the whole width in place of the panes — the empty
   * state, or a type's table. `null` shows the panes.
   */
  main?: ReactNode;
  /** Problems to report, above the panels rather than inside any one of them. */
  notices?: ReactNode;
  /**
   * The split, as equal columns.
   *
   * A grid rather than anything positioned: the panes share the width the
   * window has, and neither one knows how much of it the other took.
   */
  panes?: readonly ReactNode[];
  /**
   * What the app is doing in the background — indexing, say. Announced to a
   * screen reader rather than drawn: it is not something to read while working,
   * and the index's count and Rebuild live in Settings.
   */
  status?: ReactNode;
  /** Drawn above everything else — the search palette, for instance. */
  overlay?: ReactNode;
  /**
   * What floats over the content panel — the add button. Drawn inside the
   * panels' area, so it measures itself against them, clear of the sidebar.
   */
  floating?: ReactNode;
  sidebarOpen?: boolean;
  /** Given when the app offers a way back to a hidden sidebar. */
  onShowSidebar?: () => void;
  /** A side pane beside the work — the chat — or null for none. */
  aside?: ReactNode;
}) {
  const panels = main === null ? panes : [<MainPanel key="main">{main}</MainPanel>];

  return (
    <div className={sidebarOpen ? 'shell' : 'shell shell--narrow'}>
      {sidebarOpen && (
        <nav className="shell__sidebar" aria-label="Vault">
          {sidebar}
        </nav>
      )}
      <main className="shell__main">
        {notices}
        {panels.length > 0 && (
          <div className="shell__split" data-panes={panels.length}>
            {panels}
          </div>
        )}
        {!sidebarOpen && onShowSidebar !== undefined && (
          <button
            className="icon-button shell__show"
            type="button"
            onClick={onShowSidebar}
            aria-label="Show sidebar"
            title="Show sidebar (⌘\)"
          >
            <Icon name="panel" />
          </button>
        )}
        {floating}
      </main>
      {aside !== null && <div className="shell__aside">{aside}</div>}
      <div className="visually-hidden" role="status">
        {status}
      </div>
      {overlay}
    </div>
  );
}

/**
 * The whole-width surface, in the same panel a pane has. What it holds draws
 * its own bar — a type's table heads itself like any page — so the panel is
 * only the surface.
 */
function MainPanel({ children }: { children: ReactNode }) {
  return <section className="panel">{children}</section>;
}
