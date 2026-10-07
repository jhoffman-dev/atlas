import { useRef, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { PageCrumb } from '@atlas/domain';
import { Icon, sidebarGlyph } from './icon.tsx';
import { MenuItems, type MenuCommand } from './menu-items.tsx';
import { ChatToggleButton } from './chat/chat-toggle.tsx';

/** One command in a page's "…" menu. */
export type PageMenuItem = MenuCommand;

/**
 * Back and Forward for the pane a bar sits on. Each names where it goes, so
 * its tooltip can say so; null when there is nowhere to go, which disables it.
 */
export interface PageHistory {
  readonly back: string | null;
  readonly forward: string | null;
  readonly onBack: () => void;
  readonly onForward: () => void;
}

/**
 * The strip across the top of a page: where it is, then how it stands and
 * what can be done with it.
 *
 * Left, a breadcrumb — the section or folder, and the page's name. Right, a
 * quiet word for the save state, the star, and a "…" menu holding everything
 * that used to be a button on the page: saving now, splitting, the page's
 * properties. The arranging controls live here too, rather than floating:
 * splitting as a button before the menu, and closing a split pane as the very
 * last control, where a close sits on any panel.
 */
export function PageBar({
  crumb,
  name,
  status,
  star,
  menu = [],
  menuOpen,
  onMenuOpenChange,
  onShowSidebar,
  history,
  onSplit,
  onClose,
  closesFromShortcut = false,
}: {
  /** Null while there is no page to place — an empty pane. */
  crumb: PageCrumb | null;
  name: string | null;
  /** The save state, as a few quiet words. */
  status?: ReactNode;
  /** The favourite star, when the page can be one. */
  star?: ReactNode;
  menu?: readonly PageMenuItem[];
  /**
   * The menu's open state, when the app owns it, so it obeys the one-overlay
   * rule. Left out, the menu keeps its own.
   */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  /** Given on the first pane while the sidebar is hidden: the way back to it. */
  onShowSidebar?: () => void;
  /** Back and Forward, drawn before the breadcrumb. */
  history?: PageHistory;
  /** Given only while there is room for another pane. */
  onSplit?: () => void;
  /** Given only while there is another pane to be left with. */
  onClose?: () => void;
  /**
   * Whether the split shortcut closes this pane — it closes the focused one —
   * so the Close button's tooltip names it only where pressing it would.
   */
  closesFromShortcut?: boolean;
}) {
  return (
    // Two boxes because a container cannot query itself: the outer one is
    // measured, and the row inside it gives way as the pane narrows.
    <div className="page-bar">
      <div className="page-bar__row">
        {onShowSidebar !== undefined && (
          <button
            className="icon-button page-bar__button"
            type="button"
            onClick={onShowSidebar}
            aria-label="Show sidebar"
            title="Show sidebar (⌘\)"
          >
            <Icon name="panel" size={18} />
          </button>
        )}
        {history !== undefined && <HistoryButtons history={history} />}
        {crumb !== null && name !== null && (
          <nav className="page-bar__crumbs" aria-label="Breadcrumb">
            <Icon name={sidebarGlyph(crumb.icon)} size={16} className="page-bar__crumb-icon" />
            <span className="page-bar__parent">{crumb.parent}</span>
            <span className="page-bar__slash" aria-hidden="true">
              /
            </span>
            <span className="page-bar__name" aria-current="page" title={name}>
              {name}
            </span>
          </nav>
        )}
        <span className="page-bar__spacer" />
        {status !== undefined && (
          // A live region: "Unsaved" turning to "Saved" is announced, politely.
          <span className="page-bar__status" role="status">
            {status}
          </span>
        )}
        {star}
        <ChatToggleButton />
        {onSplit !== undefined && (
          <PaneButton
            label="Split right"
            icon="split"
            shortcut={SPLIT_SHORTCUT}
            onPress={onSplit}
          />
        )}
        {menu.length > 0 && (
          <PageMenu items={menu} open={menuOpen} onOpenChange={onMenuOpenChange} />
        )}
        {onClose !== undefined && (
          <PaneButton
            label="Close pane"
            icon="close"
            shortcut={closesFromShortcut ? SPLIT_SHORTCUT : null}
            onPress={onClose}
          />
        )}
      </div>
    </div>
  );
}

/** Splits an unsplit window and closes the focused pane of a split one. */
const SPLIT_SHORTCUT = '⇧⌘\\';

/** Splitting or closing, as an icon with its command, and its shortcut if it has one, as the tooltip. */
function PaneButton({
  label,
  icon,
  shortcut,
  onPress,
}: {
  label: 'Split right' | 'Close pane';
  icon: 'split' | 'close';
  shortcut: string | null;
  onPress: () => void;
}) {
  return (
    <button
      className="icon-button page-bar__button"
      type="button"
      onClick={onPress}
      aria-label={label}
      title={shortcut === null ? label : `${label} (${shortcut})`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

function HistoryButtons({ history }: { history: PageHistory }) {
  return (
    <div className="page-bar__history" role="group" aria-label="History">
      <HistoryButton
        label="Back"
        icon="arrow-left"
        destination={history.back}
        shortcut="⌘["
        onGo={history.onBack}
      />
      <HistoryButton
        label="Forward"
        icon="arrow-right"
        destination={history.forward}
        shortcut="⌘]"
        onGo={history.onForward}
      />
    </div>
  );
}

function HistoryButton({
  label,
  icon,
  destination,
  shortcut,
  onGo,
}: {
  label: 'Back' | 'Forward';
  icon: 'arrow-left' | 'arrow-right';
  destination: string | null;
  shortcut: string;
  onGo: () => void;
}) {
  return (
    <button
      className="icon-button page-bar__button"
      type="button"
      onClick={onGo}
      disabled={destination === null}
      aria-label={label}
      title={destination === null ? label : `${label} to ${destination} (${shortcut})`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/** The "…" menu. Open state, focus, typeahead and Escape are Base UI's (ADR-0015). */
function PageMenu({
  items,
  open,
  onOpenChange,
}: {
  items: readonly PageMenuItem[];
  open: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
}) {
  const chosen = useRef<PageMenuItem | null>(null);

  return (
    <Menu.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <Menu.Trigger className="icon-button page-bar__button" aria-label="More" title="More">
        <Icon name="more" size={18} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" side="bottom" align="end" sideOffset={6}>
          <Menu.Popup
            className="menu"
            aria-labelledby={undefined}
            aria-label="Page"
            render={<ul />}
            finalFocus={() => {
              const returnFocus = chosen.current?.movesFocus !== true;
              chosen.current = null;
              return returnFocus;
            }}
          >
            <MenuItems items={items} chosen={chosen} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
