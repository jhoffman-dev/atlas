import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { Menu } from '@base-ui/react/menu';
import { MenuItems, type MenuCommand } from './menu-items.tsx';
import type { MenuOpenedBy } from './vault-tree-row.tsx';

/** Where a row's menu opens from: the "…" pressed, or the point right-clicked. */
export type MenuAnchor = Element | { x: number; y: number };

/** The shared row menu, as the tree hands it over. */
export interface EntryMenuProps {
  readonly items: readonly MenuCommand[];
  readonly anchor: MenuAnchor | null;
  readonly openedBy: MenuOpenedBy;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Asked as the menu shuts with nothing chosen that moves the focus: true to
   * have Base UI give the focus back where it was, false when the tree has
   * put it somewhere itself because that place has gone.
   */
  readonly onReturnFocus: () => boolean;
}

const FIRST_ENABLED_ITEM = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * One row's menu, opened from its "…" or by a right-click where the pointer is.
 * Open state, focus, typeahead and Escape are Base UI's (ADR-0015).
 */
export function EntryMenu({
  items,
  anchor,
  openedBy,
  open,
  onOpenChange,
  onReturnFocus,
}: EntryMenuProps) {
  const chosen = useRef<MenuCommand | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const onKeyDownCapture = useMenuKeys({ open, onClose: () => onOpenChange(false) });
  const positioned =
    anchor === null || anchor instanceof Element
      ? anchor
      : {
          getBoundingClientRect: () =>
            DOMRect.fromRect({ x: anchor.x, y: anchor.y, width: 0, height: 0 }),
        };

  return (
    <Menu.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Menu.Portal>
        <Menu.Positioner
          className="menu-positioner"
          anchor={positioned}
          side="bottom"
          align="start"
          sideOffset={4}
        >
          <Menu.Popup
            ref={popup}
            className="menu"
            aria-label="Page"
            render={<ul />}
            onKeyDownCapture={onKeyDownCapture}
            finalFocus={() => {
              const movesFocus = chosen.current?.movesFocus === true;
              chosen.current = null;
              return !movesFocus && onReturnFocus();
            }}
          >
            <MenuItems items={items} chosen={chosen} />
            {openedBy === 'keyboard' && <FocusFirstItem popup={popup} open={open} />}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The keys the menu takes before its items do.
 *
 * - A held key's repeats are not presses. Enter held on the "…" opens the menu
 *   and then repeats into the item the focus has just moved to, which would
 *   run it; Enter or Space repeating is ignored until the menu has had a fresh
 *   key of its own.
 * - Tab leaves the menu. With no Base UI trigger to tab on from (#244), Base
 *   UI would park the focus on its invisible guard and then on the page under
 *   it, so Tab shuts the menu and the focus goes back where it was.
 */
function useMenuKeys({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): (event: KeyboardEvent<HTMLElement>) => void {
  const pressedHere = useRef(false);
  useEffect(() => {
    if (open) pressedHere.current = false;
  }, [open]);

  return (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
      return;
    }
    if (!event.repeat) {
      pressedHere.current = true;
      return;
    }
    if (!pressedHere.current && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}

/**
 * Puts the focus on a menu's first enabled item as it opens. The rows' menu is
 * shared and opened by its `open` prop rather than by a Base UI trigger
 * (#244), so Base UI never sees the key that opened it and would focus the
 * popup instead. Waiting a frame lets Base UI first mark the menu open, so it
 * takes the focused item as the one it is on, and note the "…" as where
 * Escape gives the focus back. Base UI's own initial focus, also a frame on,
 * leaves the focus alone once it is already inside the menu. A menu shut
 * before the frame runs is left alone.
 */
function FocusFirstItem({ popup, open }: { popup: RefObject<HTMLElement | null>; open: boolean }) {
  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      popup.current?.querySelector<HTMLElement>(FIRST_ENABLED_ITEM)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [popup, open]);
  return null;
}
