import { useRef } from 'react';
import { Menu } from '@base-ui/react/menu';
import { MenuItems, type MenuCommand } from './menu-items.tsx';

/** Where a type's menu opens: the row it was asked from, or the pointer. */
export type TypeMenuAnchor = Element | { x: number; y: number };

/**
 * A type row's menu in the sidebar — Open, Edit type (ADR-0023) and Edit
 * template (ADR-0026), since a
 * click on a type now lands on its views rather than its definition. Open
 * state, focus, typeahead and Escape are Base UI's (ADR-0015).
 */
export function TypeRowMenu({
  label,
  items,
  anchor,
  onClose,
}: {
  label: string;
  items: readonly MenuCommand[];
  anchor: TypeMenuAnchor | null;
  onClose: () => void;
}) {
  const chosen = useRef<MenuCommand | null>(null);
  const positioned =
    anchor === null || anchor instanceof Element
      ? anchor
      : {
          getBoundingClientRect: () =>
            DOMRect.fromRect({ x: anchor.x, y: anchor.y, width: 0, height: 0 }),
        };

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
          anchor={positioned}
          side="bottom"
          align="start"
          sideOffset={4}
        >
          <Menu.Popup
            className="menu"
            aria-label={label}
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
