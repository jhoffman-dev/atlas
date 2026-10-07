import { useState, type CSSProperties, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { WidgetResult } from '@atlas/application';
import { Icon } from '../icon.tsx';
import type { OverlaySlot } from '../overlay-slot.ts';

/**
 * Past this many columns a widget is wide, and on a narrow dashboard it takes
 * the whole row rather than half of it.
 */
const WIDE_SPAN = 6;

/** What a widget's "…" menu can do besides showing its SQL: given when the dashboard can be edited. */
export interface WidgetActions {
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}

/**
 * How a widget sits on a dashboard being arranged: the node dnd-kit measures
 * it by, how it looks while held, and its handles.
 */
export interface WidgetArranging {
  readonly frameRef: (element: HTMLElement | null) => void;
  readonly className: string;
  readonly handles: ReactNode;
}

/**
 * The tile every widget sits in: its place on the grid, its accessible name,
 * and the "…" menu that holds what is not the picture — the SQL behind it,
 * and, on a dashboard that can be edited, Edit and Remove.
 *
 * `variant` is only the look: a `card` is raised with a title, a `hero` is the
 * navy gradient, a `tile` is a small raised stat.
 */
export function WidgetFrame({
  result,
  variant,
  title,
  aside,
  menuSlot,
  actions,
  arranging,
  children,
}: {
  result: WidgetResult;
  variant: 'card' | 'hero' | 'tile';
  /** Drawn as the card's heading; heroes and tiles draw their own. */
  title?: string;
  /** Right of the heading: a total, a note, a count. */
  aside?: ReactNode;
  /** The "…" menu's open state, when the app holds it (the one-overlay rule). */
  menuSlot?: OverlaySlot | undefined;
  actions?: WidgetActions | undefined;
  arranging?: WidgetArranging | undefined;
  children: ReactNode;
}) {
  const { widget, sql } = result;
  const [showingSql, setShowingSql] = useState(false);
  const menu =
    sql === null && actions === undefined ? null : (
      <WidgetMenu
        {...(sql !== null && {
          showingSql,
          onToggleSql: () => setShowingSql((was) => !was),
        })}
        actions={actions}
        slot={menuSlot}
      />
    );

  return (
    <section
      ref={arranging?.frameRef}
      className={[
        'widget',
        `widget--${variant}`,
        `widget--${widget.kind}`,
        widget.span > WIDE_SPAN ? 'widget--wide' : '',
        arranging?.className ?? '',
      ].join(' ')}
      aria-label={widget.title}
      style={{ '--span': widget.span } as CSSProperties}
    >
      {arranging?.handles}
      {title === undefined ? (
        menu !== null && <div className="widget__menu-corner">{menu}</div>
      ) : (
        <header className="widget__header">
          <h2 className="widget__title">{title}</h2>
          <span className="widget__spacer" />
          {aside}
          {menu}
        </header>
      )}
      {children}
      {showingSql && sql !== null && <pre className="widget__sql">{sql}</pre>}
    </section>
  );
}

/**
 * The widget's own "…". The SQL used to sit on every card as a small "SQL" tag
 * with the query in its tooltip; it is the way to take a widget elsewhere, not
 * something to read every time the dashboard opens.
 */
export function WidgetMenu({
  showingSql = false,
  onToggleSql,
  actions,
  slot,
}: {
  showingSql?: boolean;
  /** Absent for a widget with no SQL to show — one that could not be run. */
  onToggleSql?: () => void;
  actions?: WidgetActions | undefined;
  slot?: OverlaySlot | undefined;
}) {
  return (
    <Menu.Root {...slot}>
      <Menu.Trigger className="icon-button widget__menu" aria-label="Widget options">
        <Icon name="more" size={18} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="menu" aria-label="Widget" render={<ul />}>
            {actions !== undefined && (
              <>
                <MenuItem label="Edit widget" onClick={actions.onEdit} />
                <MenuItem label="Remove widget" onClick={actions.onRemove} />
              </>
            )}
            {onToggleSql !== undefined && (
              <MenuItem label={showingSql ? 'Hide SQL' : 'Show SQL'} onClick={onToggleSql} />
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <Menu.Item nativeButton render={<button type="button" />} onClick={onClick}>
        <span className="menu__label">{label}</span>
      </Menu.Item>
    </li>
  );
}
