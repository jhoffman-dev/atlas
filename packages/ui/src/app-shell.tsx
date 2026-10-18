import type { ReactNode } from 'react';
import { Icon } from './icon.tsx';

/**
 * The window: the sidebar on the ground colour behind a hairline, and the work
 * edge to edge on the surface beside it — one panel, or one per pane when the
 * window is split, with a hairline between them.
 */
export function AppShell({
  sidebar,
  main = null,
  notices = null,
  panes = null,
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
   * The panes, drawn by the app inside a `PaneSplit` of its own, since how
   * many there are is the app's to know. Null shows nothing.
   */
  panes?: ReactNode;
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
  const work =
    main === null ? (
      panes
    ) : (
      <PaneSplit count={1}>
        <MainPanel>{main}</MainPanel>
      </PaneSplit>
    );

  return (
    <div className={sidebarOpen ? 'shell' : 'shell shell--narrow'}>
      {sidebarOpen && (
        <nav className="shell__sidebar" aria-label="Vault">
          {sidebar}
        </nav>
      )}
      <main className="shell__main">
        {notices}
        {work}
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
 * The split, as equal columns.
 *
 * A grid rather than anything positioned: the panes share the width the
 * window has, and neither one knows how much of it the other took. `count`
 * is how many columns the grid draws, which is how many panes it is given.
 */
export function PaneSplit({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className="shell__split" data-panes={count}>
      {children}
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
