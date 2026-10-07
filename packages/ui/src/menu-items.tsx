import { Fragment, type MutableRefObject } from 'react';
import { Menu } from '@base-ui/react/menu';

/** One command in a "…" menu. */
export interface MenuCommand {
  readonly label: string;
  readonly onSelect: () => void;
  /** The shortcut that does the same, shown beside it. */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /**
   * The command moves the work somewhere else — another pane, a dialog, a
   * field in the tree — so focus is not handed back to what opened the menu.
   */
  readonly movesFocus?: boolean;
  /** Deletes something: drawn in the danger tone and set apart below a divider. */
  readonly destructive?: boolean;
}

/**
 * A menu's rows, the same in every menu: Base UI items in a list, a divider
 * before anything destructive. `chosen` records the command picked, so the
 * popup can decide where focus goes once it closes.
 */
export function MenuItems({
  items,
  chosen,
}: {
  items: readonly MenuCommand[];
  chosen: MutableRefObject<MenuCommand | null>;
}) {
  const firstDestructive = items.findIndex((item) => item.destructive === true);
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index === firstDestructive && index > 0 && (
            <li className="menu__divider" role="separator" />
          )}
          <li>
            <Menu.Item
              nativeButton
              render={<button type="button" />}
              className={item.destructive === true ? 'menu__item--danger' : undefined}
              disabled={item.disabled === true}
              onClick={() => {
                chosen.current = item;
                item.onSelect();
              }}
            >
              <span className="menu__label">{item.label}</span>
              {item.shortcut !== undefined && (
                <kbd className="key menu__shortcut">{item.shortcut}</kbd>
              )}
            </Menu.Item>
          </li>
        </Fragment>
      ))}
    </>
  );
}
