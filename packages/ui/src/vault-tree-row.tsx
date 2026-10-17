import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  isMarkdownFile,
  type SidebarTreeRow,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import { Icon, sidebarGlyph } from './icon.tsx';
import { FavoriteStar } from './favorite-star.tsx';
import { isImeKey } from './ime.ts';
import { sameEntries } from './steady-value.ts';

const DROP_PREFIX = 'into:';

/** The id a folder row is dropped on by, kept apart from the ids rows are dragged by. */
const dropIdOf = (path: VaultPath): string => `${DROP_PREFIX}${path}`;

/** The folder a drop id names, or undefined for anything that is not a folder's. */
export function folderOfDropId(id: string): VaultPath | undefined {
  return id.startsWith(DROP_PREFIX) ? (id.slice(DROP_PREFIX.length) as VaultPath) : undefined;
}

/** Where a row sits and how it is drawn — everything the virtualiser decides. */
export interface RowPlacement {
  readonly index: number;
  /** How far down the tree the row is placed, in pixels. */
  readonly top: number;
  readonly height: number;
  /** How far the row is set in, in pixels. */
  readonly indent: number;
  readonly tabbable: boolean;
  readonly selected: boolean;
}

/** What a row can be while Pages is editable: being named in place, or a place to drop. */
export interface RowEditing {
  /** Whether this row is being named in place. */
  readonly renaming: boolean;
  /** Whether what is held can be dropped here; false for anything but a folder. */
  readonly accepts: boolean;
}

/**
 * How a row's menu was asked for. From the keyboard it opens on its first
 * item, as a menu button does; from the pointer, on the menu itself.
 */
export type MenuOpenedBy = 'keyboard' | 'pointer';

/**
 * What every row can do, the same object for every row and from one render
 * to the next, so a row draws again only for a change of its own (#238).
 */
export interface TreeRowActions {
  readonly onActivate: (row: SidebarTreeRow) => void;
  /** Moves the tab order to the row. */
  readonly onFocusRow: (path: VaultPath) => void;
  readonly onToggleFavorite: (path: VaultPath) => void;
  /** Opens the row's menu, anchored to the element or the point it was asked from. */
  readonly onMenu: (
    entry: VaultEntry,
    anchor: Element | { x: number; y: number },
    openedBy: MenuOpenedBy,
  ) => void;
  readonly onRename: (args: { entry: VaultEntry; name: string }) => void;
  readonly onCancelRename: () => void;
}

/** One row as the tree hands it over. */
export interface VaultTreeRowProps {
  readonly row: SidebarTreeRow;
  readonly placement: RowPlacement;
  /** Null while the tree only opens and expands: no menu, no naming, no drag. */
  readonly editing: RowEditing | null;
  readonly starred: boolean;
  readonly actions: TreeRowActions;
}

/**
 * One row of Pages: a note or a folder, its star, and its "…".
 *
 * A pointer picks it up from anywhere on the row and Space picks it up from
 * the keyboard; a press that travels less than a few pixels is still a click.
 * A folder is also a drop target, lit while something it accepts is over it.
 *
 * Drawn again only when what it shows changes: the sidebar is drawn again for
 * everything the window does, and every row with it was most of what opening
 * a note drew (#238). Its placement and editing state are compared field by
 * field, since the tree works them out afresh for each row it draws.
 */
export const VaultTreeRow = memo(function VaultTreeRow({
  row,
  placement,
  editing,
  starred,
  actions,
}: VaultTreeRowProps) {
  const path = row.entry.path;
  // The Archive's row opens a page rather than a level of the tree.
  const isDirectory = row.entry.kind === 'directory' && !row.opensArchive;
  const renaming = editing?.renaming === true;
  const drag = useDraggable({ id: path, disabled: editing === null || renaming });
  const drop = useDroppable({ id: dropIdOf(path), disabled: editing === null || !isDirectory });
  const lit = drop.isOver && editing?.accepts === true;

  const setRef = (element: HTMLDivElement | null) => {
    drag.setNodeRef(element);
    drop.setNodeRef(element);
  };

  const classes = ['tree__row'];
  if (placement.selected) classes.push('tree__row--selected');
  if (lit) classes.push('tree__row--drop');
  if (drag.isDragging) classes.push('tree__row--held');

  return (
    <div
      ref={setRef}
      role="treeitem"
      data-row={placement.index}
      // Named explicitly: the star inside the row is a button of its own, and
      // without this the row would be announced as its name followed by what
      // its star would do.
      aria-label={row.label}
      aria-level={row.depth + 1}
      aria-expanded={isDirectory ? row.isExpanded : undefined}
      aria-selected={placement.selected}
      aria-describedby={editing === null ? undefined : drag.attributes['aria-describedby']}
      tabIndex={placement.tabbable ? 0 : -1}
      className={classes.join(' ')}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: placement.height,
        transform: `translateY(${placement.top}px)`,
        paddingLeft: placement.indent,
      }}
      {...(editing !== null && !renaming && drag.listeners)}
      onFocus={(event) => {
        // React's onFocus bubbles, so the star inside the row reports here
        // too: it is the row's turn only when the row itself was focused.
        if (event.target === event.currentTarget) actions.onFocusRow(path);
      }}
      onClick={() => {
        if (renaming) return;
        actions.onFocusRow(path);
        actions.onActivate(row);
      }}
      onContextMenu={(event) => {
        if (editing === null) return;
        event.preventDefault();
        actions.onMenu(row.entry, { x: event.clientX, y: event.clientY }, 'pointer');
      }}
    >
      <Icon name={sidebarGlyph(row.icon)} className="sidebar__icon" />
      {renaming && editing !== null ? (
        <RenameField
          name={row.label}
          onRename={(name) => actions.onRename({ entry: row.entry, name })}
          onCancel={actions.onCancelRename}
        />
      ) : (
        <span className="tree__name">{row.label}</span>
      )}
      {/* Only a note can be a favourite: a folder is not a thing to open. */}
      {isMarkdownFile(row.entry) && !renaming && (
        <FavoriteStar
          name={row.label}
          favorite={starred}
          onToggle={() => actions.onToggleFavorite(path)}
          tabbable={placement.tabbable}
        />
      )}
      {/* Last, at the row's end, and after the star in the tab order: the
          star is the stop people reach for most. */}
      {editing !== null && !renaming && (
        <MoreButton
          label={row.label}
          tabbable={placement.tabbable}
          onOpen={(event) =>
            // Enter or Space on a button clicks it with no press counted.
            actions.onMenu(
              row.entry,
              event.currentTarget,
              event.detail === 0 ? 'keyboard' : 'pointer',
            )
          }
        />
      )}
    </div>
  );
}, sameTreeRow);

/** Whether a row would draw the same as it did. */
function sameTreeRow(before: VaultTreeRowProps, after: VaultTreeRowProps): boolean {
  return (
    before.row === after.row &&
    before.starred === after.starred &&
    before.actions === after.actions &&
    sameEntries(before.placement, after.placement) &&
    (before.editing === after.editing ||
      (before.editing !== null &&
        after.editing !== null &&
        sameEntries(before.editing, after.editing)))
  );
}

/** The row's "…": shown on hover and on the focused row, and always reachable by Tab. */
function MoreButton({
  label,
  tabbable,
  onOpen,
}: {
  label: string;
  tabbable: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="tree__more"
      aria-label={`Options for ${label}`}
      title="Options"
      tabIndex={tabbable ? 0 : -1}
      // Not the row's: a press here is not the start of a drag, and a click
      // opens the menu rather than the note.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event);
      }}
    >
      <Icon name="more" size={15} />
    </button>
  );
}

/**
 * Naming a note or a folder where it sits. Enter or leaving the field keeps
 * the name; Escape keeps the old one.
 */
function RenameField({
  name,
  onRename,
  onCancel,
}: {
  name: string;
  onRename: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  // Focused as it appears, with the name selected to be typed over.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const [done, setDone] = useState(false);
  const finish = (keep: boolean) => {
    if (done) return;
    setDone(true);
    if (keep && value.trim() !== '' && value !== name) onRename(value);
    else onCancel();
  };

  return (
    <input
      className="tree__rename"
      aria-label={`Name for ${name}`}
      value={value}
      ref={field}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !isImeKey(event)) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
