import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { isMarkdownFile, type SidebarTreeRow, type VaultPath } from '@atlas/domain';
import { Icon, sidebarGlyph } from './icon.tsx';
import { FavoriteStar } from './favorite-star.tsx';
import { isImeKey } from './ime.ts';

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
  readonly style: CSSProperties;
  readonly tabbable: boolean;
  readonly selected: boolean;
}

/** What a row can do beyond opening: the menu, naming in place, being dragged. */
export interface RowEditing {
  /** Opens the row's menu, anchored to the element or the point it was asked from. */
  readonly onMenu: (anchor: Element | { x: number; y: number }) => void;
  /** Whether this row is being named in place. */
  readonly renaming: boolean;
  readonly onRename: (name: string) => void;
  readonly onCancelRename: () => void;
  /** Whether what is held can be dropped here; false for anything but a folder. */
  readonly accepts: boolean;
}

/**
 * One row of Pages: a note or a folder, its star, and its "…".
 *
 * A pointer picks it up from anywhere on the row and Space picks it up from
 * the keyboard; a press that travels less than a few pixels is still a click.
 * A folder is also a drop target, lit while something it accepts is over it.
 */
export function VaultTreeRow({
  row,
  placement,
  editing,
  starred,
  onActivate,
  onFocusRow,
  onToggleFavorite,
}: {
  row: SidebarTreeRow;
  placement: RowPlacement;
  editing: RowEditing | null;
  starred: boolean;
  onActivate: () => void;
  onFocusRow: () => void;
  onToggleFavorite: () => void;
}) {
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
      style={placement.style}
      {...(editing !== null && !renaming && drag.listeners)}
      onFocus={(event) => {
        // React's onFocus bubbles, so the star inside the row reports here
        // too: it is the row's turn only when the row itself was focused.
        if (event.target === event.currentTarget) onFocusRow();
      }}
      onClick={() => {
        if (renaming) return;
        onFocusRow();
        onActivate();
      }}
      onContextMenu={(event) => {
        if (editing === null) return;
        event.preventDefault();
        editing.onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <Icon name={sidebarGlyph(row.icon)} className="sidebar__icon" />
      {renaming && editing !== null ? (
        <RenameField
          name={row.label}
          onRename={editing.onRename}
          onCancel={editing.onCancelRename}
        />
      ) : (
        <span className="tree__name">{row.label}</span>
      )}
      {/* Only a note can be a favourite: a folder is not a thing to open. */}
      {isMarkdownFile(row.entry) && !renaming && (
        <FavoriteStar
          name={row.label}
          favorite={starred}
          onToggle={onToggleFavorite}
          tabbable={placement.tabbable}
        />
      )}
      {/* Last, at the row's end, and after the star in the tab order: the
          star is the stop people reach for most. */}
      {editing !== null && !renaming && (
        <MoreButton
          label={row.label}
          tabbable={placement.tabbable}
          onOpen={(event) => editing.onMenu(event.currentTarget)}
        />
      )}
    </div>
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
