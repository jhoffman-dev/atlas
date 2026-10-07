import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import {
  DndContext,
  DragOverlay,
  getClientRect,
  type Announcements,
  type ClientRect,
  type MeasuringConfiguration,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { Menu } from '@base-ui/react/menu';
import type { SidebarTreeRow, VaultEntry, VaultPath } from '@atlas/domain';
import { Icon, sidebarGlyph } from './icon.tsx';
import { MenuItems, type MenuCommand } from './menu-items.tsx';
import { dropTargetWithin, snapToNextRow, useDragSensors } from './drag/dnd.ts';
import { treeWords } from './drag/announcements.ts';
import { folderOfDropId, VaultTreeRow, type RowEditing } from './vault-tree-row.tsx';
import { stickyOffsetOf, useScrollMargin } from './scroll-margin.ts';

/** A row's pitch: 29px tall with a pixel between rows, as in the mockup. */
const ROW_HEIGHT = 30;
const ROW_GAP = 1;
const INDENT = 14;
/** How long a typed prefix keeps collecting letters before it starts over. */
const TYPE_AHEAD_MS = 1000;

/** `indexes`, sorted, with `index` among them; as they were when it is -1. */
function withIndex(indexes: number[], index: number): number[] {
  if (index < 0 || indexes.includes(index)) return indexes;
  return [...indexes, index].sort((a, b) => a - b);
}

/** What `area` shows of its content, in client coordinates: all but the top `covered` pixels. */
function shownPart(area: HTMLElement, covered: number): ClientRect {
  const { left, right, top, bottom } = area.getBoundingClientRect();
  const shownTop = Math.min(top + covered, bottom);
  return { left, right, top: shownTop, bottom, width: right - left, height: bottom - shownTop };
}

/** The row that holds this one: the nearest row above it at a shallower depth. */
function parentIndex(rows: readonly SidebarTreeRow[], index: number): number {
  const depth = rows[index]?.depth ?? 0;
  for (let above = index - 1; above >= 0; above -= 1) {
    if ((rows[above]?.depth ?? 0) < depth) return above;
  }
  return index;
}

/**
 * The next row whose name starts with what has just been typed, searching on
 * past the end and round to where it started. -1 when nothing matches.
 */
function matchIndex(rows: readonly SidebarTreeRow[], from: number, prefix: string): number {
  for (let step = 1; step <= rows.length; step += 1) {
    const at = (from + step) % rows.length;
    if (rows[at]?.label.toLowerCase().startsWith(prefix)) return at;
  }
  return -1;
}

/**
 * What Pages can do to its entries besides open them: each row's menu, naming
 * in place, and dragging onto a folder. Left out, the tree only opens and expands.
 */
export interface TreeEditing {
  /** The commands in an entry's menu, in order. */
  readonly menuFor: (entry: VaultEntry) => readonly MenuCommand[];
  /** The menu's open state, owned by the app's one-overlay rule. */
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  /** The entry being named in place, if any. */
  readonly renaming: VaultPath | null;
  readonly onRename: (args: { entry: VaultEntry; name: string }) => void;
  readonly onCancelRename: () => void;
  /** Whether `entry` can be dropped into `folder` — the domain's rule, asked. */
  readonly canDrop: (args: { entry: VaultEntry; folder: VaultPath }) => boolean;
  readonly onDrop: (args: { entry: VaultEntry; folder: VaultPath }) => void;
}

/**
 * Rows measured where they are drawn. dnd-kit measures without transforms by
 * default, so that its own do not count twice; the virtualiser places every
 * row with one, and without it every row measures as the first — a note picked
 * up from the keyboard was at once "over" whatever folder sat at the top.
 */
const MEASURED_WHERE_DRAWN: MeasuringConfiguration = {
  draggable: { measure: getClientRect },
  droppable: { measure: getClientRect },
};

/** Where a row's menu opens from: the "…" pressed, or the point right-clicked. */
type MenuAnchor = Element | { x: number; y: number };

/**
 * The vault's folders and notes. Virtualised, so a vault with tens of thousands of
 * notes costs the same to render as one with ten.
 *
 * Navigated the way a tree is: one row at a time is in the tab order (a roving
 * tabindex), the arrows move between rows, and Tab leaves for the focused row's
 * star and then for whatever follows the sidebar. Arrow keys stop at this
 * section's ends — sweeping across the sidebar's five sections is a different
 * design, recorded in ADR-0013.
 */
export function VaultTree({
  rows,
  open,
  starred,
  onToggleDirectory,
  onSelectFile,
  onToggleFavorite,
  onOpenArchive,
  editing,
  scrollParent,
}: {
  rows: readonly SidebarTreeRow[];
  /** The paths on screen right now: a split has a note open in each pane. */
  open: ReadonlySet<string>;
  /** The notes that are favourites, so a starred row shows it without asking. */
  starred: ReadonlySet<string>;
  onToggleDirectory: (path: VaultPath) => void;
  onSelectFile: (path: VaultPath) => void;
  onToggleFavorite: (path: VaultPath) => void;
  /** What the Archive's row does in place of opening: shows the Archive. */
  onOpenArchive?: () => void;
  editing?: TreeEditing;
  /**
   * The element that scrolls the tree along with whatever sits around it — the
   * sidebar's one scroller; null until it is mounted. Left out, the tree
   * scrolls itself.
   */
  scrollParent?: HTMLElement | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(scrollRef, scrollParent ?? null);
  // The sticky heading over a shared scroller's top edge, as its stylesheet has it.
  const stickyOffset = useMemo(() => stickyOffsetOf(scrollParent ?? null), [scrollParent]);
  /** The row the tab order points at, held by path so it survives the list changing. */
  const [activePath, setActivePath] = useState<string | null>(null);
  /** A row asked for the focus that the virtualiser has not rendered yet. */
  const wantedIndex = useRef<number | null>(null);
  const typed = useRef({ prefix: '', at: 0 });
  /** The entry whose menu is up, and where it opened from. */
  const [menu, setMenu] = useState<{ entry: VaultEntry; anchor: MenuAnchor } | null>(null);
  /** The entry being carried, while a drag is under way. */
  const [held, setHeld] = useState<SidebarTreeRow | null>(null);
  const sensors = useDragSensors(snapToNextRow);
  const byPath = useMemo(
    () => new Map<string, SidebarTreeRow>(rows.map((row) => [row.entry.path, row])),
    [rows],
  );
  const announcements = useMemo(() => treeAnnouncements(byPath), [byPath]);

  const scrollElement = () => (scrollParent === undefined ? scrollRef.current : scrollParent);
  const heldIndex =
    held === null ? -1 : rows.findIndex((row) => row.entry.path === held.entry.path);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // Where the rows start in a scroller they share, and the sticky heading
    // over its top edge that a row scrolled to must not sit under.
    scrollMargin,
    scrollPaddingStart: stickyOffset,
    // Starts from where the scroller already is. Shared, it was scrolled
    // before the tree existed, and the virtualiser otherwise scrolls it to 0
    // as it attaches, throwing away the place of the heading that opened it.
    initialOffset: () => scrollElement()?.scrollTop ?? 0,
    // The row being carried stays rendered however far it is scrolled away:
    // dnd-kit finds the scroller to scroll at an edge from it (or from the
    // target under the pointer), and with neither the sidebar stops scrolling.
    rangeExtractor: (range: Range) => withIndex(defaultRangeExtractor(range), heldIndex),
    // jsdom reports a zero-height container, which would render no rows at all.
    initialRect: { width: 280, height: 800 },
  });

  /** Focuses a row, if the virtualiser is currently holding it in the DOM. */
  const focusRendered = (index: number): boolean => {
    const element = scrollRef.current?.querySelector<HTMLDivElement>(`[data-row="${index}"]`);
    if (!element) return false;
    element.focus();
    return true;
  };

  // Finishes a move to a row that was not rendered when it was asked for: the
  // scroll in `focusRow` puts it in the DOM, that renders, and this focuses it.
  // Deliberately on every render — there is no value to depend on, only whether
  // the row has appeared yet.
  useEffect(() => {
    const index = wantedIndex.current;
    if (index !== null && focusRendered(index)) wantedIndex.current = null;
  });

  // A row named in place — a new folder or note, or a rename — is scrolled to
  // first: deep in the tree a new row is not rendered at all, and one half
  // under the sticky heading would be named half out of sight. Its field
  // focuses itself as it is drawn.
  const renaming = editing?.renaming ?? null;
  const renamingIndex =
    renaming === null ? -1 : rows.findIndex((row) => row.entry.path === renaming);
  useEffect(() => {
    if (renamingIndex >= 0) virtualizer.scrollToIndex(renamingIndex);
  }, [renamingIndex, virtualizer]);

  // Only where the scroller shows the tree is a row a drop target: one
  // scrolled under the sticky heading, or past the scroller's edge, is still
  // laid out there but cannot be seen, and the pointer is over what covers it.
  const collisionDetection = useMemo(
    () =>
      dropTargetWithin(() => {
        const area = scrollParent === undefined ? scrollRef.current : scrollParent;
        return area === null ? null : shownPart(area, stickyOffset);
      }),
    [scrollParent, stickyOffset],
  );

  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => row.entry.path === activePath),
  );

  const focusRow = (index: number) => {
    const row = rows[index];
    if (row === undefined) return;
    setActivePath(row.entry.path);
    // Scrolled to first: focusing a row the virtualiser has dropped would
    // otherwise mean rendering every row, which is the guarantee this tree
    // exists to keep.
    virtualizer.scrollToIndex(index);
    wantedIndex.current = focusRendered(index) ? null : index;
  };

  const activate = (row: SidebarTreeRow) => {
    if (row.opensArchive) onOpenArchive?.();
    else if (row.entry.kind === 'directory') onToggleDirectory(row.entry.path);
    else onSelectFile(row.entry.path);
  };

  const jumpToTyped = (letter: string, from: number) => {
    const now = Date.now();
    const prefix = now - typed.current.at < TYPE_AHEAD_MS ? typed.current.prefix + letter : letter;
    typed.current = { prefix, at: now };
    // A letter pressed over and over cycles through the rows under it, rather
    // than searching for a name that starts "aaa".
    const query = [...prefix].every((each) => each === letter) ? letter : prefix;
    const found = matchIndex(rows, from, query);
    if (found >= 0) focusRow(found);
  };

  const openMenu = (entry: VaultEntry, anchor: MenuAnchor) => {
    setMenu({ entry, anchor });
    editing?.onMenuOpenChange(true);
  };

  const drop = ({ active, over }: DragEndEvent) => {
    setHeld(null);
    const entry = byPath.get(String(active.id))?.entry;
    const folder = over === null ? undefined : folderOfDropId(String(over.id));
    if (editing === undefined || entry === undefined || folder === undefined) return;
    if (editing.canDrop({ entry, folder })) editing.onDrop({ entry, folder });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only from a row itself. The star inside a row is a button with its own
    // Enter and Space, and the arrows are not the tree's to take from it.
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.getAttribute('role') !== 'treeitem') return;
    // While something is carried the arrows move it, not the focus.
    if (held !== null) return;

    // The row that has the focus, read off the element the key arrived at
    // rather than from state, which is a render behind a focus that has just
    // moved.
    const at = Number(event.target.getAttribute('data-row'));
    const row = rows[at];
    if (row === undefined) return;
    const isOpenDirectory = row.entry.kind === 'directory' && row.isExpanded;
    const last = rows.length - 1;

    switch (event.key) {
      case 'ArrowDown':
        focusRow(Math.min(at + 1, last));
        break;
      case 'ArrowUp':
        focusRow(Math.max(at - 1, 0));
        break;
      case 'Home':
        focusRow(0);
        break;
      case 'End':
        focusRow(last);
        break;
      case 'ArrowRight':
        if (row.entry.kind !== 'directory' || row.opensArchive) return;
        // Into the folder if it is already open — but only if it holds
        // something, since the row below an empty one is a sibling.
        if (!isOpenDirectory) onToggleDirectory(row.entry.path);
        else if ((rows[at + 1]?.depth ?? 0) > row.depth) focusRow(at + 1);
        break;
      case 'ArrowLeft':
        if (isOpenDirectory) onToggleDirectory(row.entry.path);
        else focusRow(parentIndex(rows, at));
        break;
      case 'Enter':
        activate(row);
        break;
      case ' ':
        // Space picks a row up when it can be moved (ADR-0015); dnd-kit has it.
        if (editing !== undefined) return;
        activate(row);
        break;
      case 'F10':
      case 'ContextMenu':
        // Shift+F10 or the menu key: the row's menu, from the keyboard.
        if (editing === undefined || (event.key === 'F10' && !event.shiftKey)) return;
        openMenu(row.entry, event.target);
        break;
      default:
        // A printable character is type-ahead; a chord belongs to the app.
        if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
        jumpToTyped(event.key.toLowerCase(), at);
        break;
    }
    // Only reached when a key above was handled; the arrows and Space would
    // otherwise scroll the tree out from under the row that has the focus.
    event.preventDefault();
  };

  // Shared, the tree is no scroller of its own; alone, it scrolls itself.
  const treeClass = scrollParent === undefined ? 'tree' : 'tree tree--shared';

  if (rows.length === 0) {
    return (
      <div className={`${treeClass} tree--empty`} ref={scrollRef}>
        <p className="tree__empty">Nothing here yet.</p>
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();
  // Tab has to land somewhere in the tree, so when the active row has been
  // scrolled out of the DOM the first rendered row stands in for it.
  const tabbableIndex = items.some((item) => item.index === activeIndex)
    ? activeIndex
    : (items[0]?.index ?? -1);

  // The Archive's row is a way in, not a folder to edit: no menu, no drag, no drop.
  const rowEditing = (row: SidebarTreeRow): RowEditing | null =>
    editing === undefined || row.opensArchive
      ? null
      : {
          onMenu: (anchor) => openMenu(row.entry, anchor),
          renaming: editing.renaming === row.entry.path,
          onRename: (name) => editing.onRename({ entry: row.entry, name }),
          onCancelRename: editing.onCancelRename,
          accepts:
            held !== null &&
            row.entry.kind === 'directory' &&
            editing.canDrop({ entry: held.entry, folder: row.entry.path }),
        };

  const tree = (
    <div className={treeClass} ref={scrollRef}>
      <div
        role="tree"
        onKeyDown={onKeyDown}
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {items.map((item) => {
          const row = rows[item.index];
          if (row === undefined) return null;
          return (
            <VaultTreeRow
              key={row.entry.path}
              row={row}
              placement={{
                index: item.index,
                tabbable: item.index === tabbableIndex,
                selected: open.has(row.entry.path),
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: item.size - ROW_GAP,
                  transform: `translateY(${item.start - scrollMargin}px)`,
                  paddingLeft: 10 + row.depth * INDENT,
                },
              }}
              editing={rowEditing(row)}
              starred={starred.has(row.entry.path)}
              // A click moves the tab order with it, so coming back to the
              // tree comes back to the row that was last used.
              onFocusRow={() => setActivePath(row.entry.path)}
              onActivate={() => activate(row)}
              onToggleFavorite={() => onToggleFavorite(row.entry.path)}
            />
          );
        })}
      </div>
    </div>
  );

  if (editing === undefined) return tree;

  return (
    <DndContext
      sensors={sensors}
      measuring={MEASURED_WHERE_DRAWN}
      collisionDetection={collisionDetection}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: treeWords.instructions },
      }}
      onDragStart={({ active }) => setHeld(byPath.get(String(active.id)) ?? null)}
      onDragEnd={drop}
      onDragCancel={() => setHeld(null)}
    >
      {tree}
      {/* A picture of the row under the pointer, above the sidebar, which
          would clip it — and drawn from the body, since the sidebar's scroller
          is a stacking context of its own, which the work panel covers.
          Hidden from assistive technology: the announcements say where it is. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {held === null ? null : (
            <div className="tree__row tree__row--lifted" aria-hidden="true">
              <Icon name={sidebarGlyph(held.icon)} className="sidebar__icon" />
              <span className="tree__name">{held.label}</span>
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
      <EntryMenu
        items={menu === null ? [] : editing.menuFor(menu.entry)}
        anchor={menu?.anchor ?? null}
        open={editing.menuOpen && menu !== null}
        onOpenChange={(next) => {
          editing.onMenuOpenChange(next);
          if (!next) setMenu(null);
        }}
      />
    </DndContext>
  );
}

/** The sentences a screen reader hears while a row is carried: names, not paths. */
function treeAnnouncements(byPath: ReadonlyMap<string, SidebarTreeRow>): Announcements {
  const name = (id: UniqueIdentifier) => byPath.get(String(id))?.label ?? String(id);
  const folder = (id: UniqueIdentifier | undefined) => {
    const path = id === undefined ? undefined : folderOfDropId(String(id));
    return path === undefined ? null : (byPath.get(path)?.label ?? path);
  };
  return {
    onDragStart: ({ active }) => treeWords.start(name(active.id)),
    onDragOver: ({ active, over }) => treeWords.over(name(active.id), folder(over?.id)),
    onDragEnd: ({ active, over }) => treeWords.end(name(active.id), folder(over?.id)),
    onDragCancel: ({ active }) => treeWords.cancel(name(active.id)),
  };
}

/**
 * One row's menu, opened from its "…" or by a right-click where the pointer is.
 * Open state, focus, typeahead and Escape are Base UI's (ADR-0015).
 */
function EntryMenu({
  items,
  anchor,
  open,
  onOpenChange,
}: {
  items: readonly MenuCommand[];
  anchor: MenuAnchor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
            className="menu"
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
