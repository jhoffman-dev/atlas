import { useRef } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Icon } from './icon.tsx';
import { MenuItems, type MenuCommand } from './menu-items.tsx';

/**
 * A link's menu in a note (P22-02): open it, or switch it between a link and
 * a bookmark. Opened from the "…" that shows on a link under the pointer or
 * on a card, by a right-click, or by Shift+F10 with the caret on the link.
 * Open state, focus, typeahead and Escape are Base UI's (ADR-0015); once it
 * closes, the cursor goes back to the note.
 */
export function LinkMenu({
  anchor,
  items,
  onClose,
}: {
  /** What the menu hangs from; null when it is closed. */
  anchor: Element | null;
  items: readonly MenuCommand[];
  onClose: () => void;
}) {
  const chosen = useRef<MenuCommand | null>(null);
  return (
    <Menu.Root
      open={anchor !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Menu.Portal>
        <Menu.Positioner
          className="menu-positioner"
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={4}
        >
          <Menu.Popup className="menu" aria-label="Link" render={<ul />} finalFocus={false}>
            <MenuItems items={items} chosen={chosen} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The "…" that shows over a link in a note while the pointer is on it — the
 * way to its menu for a mouse. Pressing it opens the menu from here.
 */
export function LinkHoverButton({
  rect,
  onOpen,
  onPointerInside,
}: {
  /** The link's box on screen. */
  rect: DOMRect;
  onOpen: () => void;
  /** Whether the pointer is over the button, which keeps it up. */
  onPointerInside: (inside: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="link-hover icon-button"
      aria-label="Link options"
      style={{ top: rect.top - 30, left: rect.left }}
      onMouseEnter={() => onPointerInside(true)}
      onMouseLeave={() => onPointerInside(false)}
      // The caret stays in the note until the menu takes the focus.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      <Icon name="more" size={16} />
    </button>
  );
}
