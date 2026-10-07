import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  columnSummary,
  countLabel,
  groupLines,
  type BoardRow,
  type GroupLine,
  type PropertyKind,
  type RowGroup,
} from '@atlas/domain';
import { Icon } from './icon.tsx';
import { StatusPill } from './status-pill.tsx';

/** A table's groups, which are folded shut, and what can be done to them. */
export interface TableGrouping {
  readonly groups: readonly RowGroup[];
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  /** Adds a note inside a group — it and the groups it is in. Given, each innermost group ends with "+ New". */
  readonly onNew?: ((chain: readonly RowGroup[]) => void) | undefined;
}

/**
 * Where a line sits among the lines the virtualiser places, and the ref that
 * measures it: a row whose cell wraps is taller than the estimate, and lines
 * placed by the estimate alone would drift over one another.
 */
export interface LinePlace {
  readonly index: number;
  readonly measure: (element: Element | null) => void;
}

/** A shown column: its key, and its kind, which says whether its header summary adds up. */
export interface SummaryColumn {
  readonly key: string;
  readonly kind?: PropertyKind | undefined;
}

/** Heights the virtualiser places lines by, matching the stylesheet's. */
const LINE_HEIGHT: Readonly<Record<GroupLine['kind'], number>> = { group: 44, row: 44, new: 38 };

/**
 * A table's rows in their groups and sub-groups, as Coda draws them: each
 * group a full-width header row — disclosure arrow, the value (a pill for a
 * select), how many rows, and a summary under every column that adds up — with
 * its sub-groups one step in, and "+ New" at the foot of each innermost group.
 *
 * Virtualised: only the lines near the scroller's window are in the page, and
 * a folded group is a header and nothing else. Up and Down move between the
 * headers; Enter and Space fold one, as a button does.
 */
export function GroupedRows({
  grouping,
  columns,
  lead,
  noun,
  newLabel,
  renderRow,
  scroller,
}: {
  grouping: TableGrouping;
  /** The shown columns in order, the name first. */
  columns: readonly SummaryColumn[];
  /** Cells each row leads with before its name: a choose box, a done box. */
  lead: number;
  /** The type's name, for "3 tasks". */
  noun: string;
  /** "New task". */
  newLabel: string;
  renderRow: (row: BoardRow, place: LinePlace) => ReactNode;
  /** The element the table scrolls in. */
  scroller: RefObject<HTMLElement | null>;
}) {
  const { groups, collapsed, onToggle, onNew } = grouping;
  // Without a way to add a note there is no "+ New" line to make room for.
  const lines = useMemo(
    () =>
      groupLines({ groups, collapsed }).filter(
        (line) => onNew !== undefined || line.kind !== 'new',
      ),
    [groups, collapsed, onNew],
  );
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => LINE_HEIGHT[lines[index]?.kind ?? 'row'],
    overscan: 12,
    // jsdom reports a zero-height scroller, which would draw no lines at all.
    initialRect: { width: 960, height: 880 },
  });
  const focus = useHeaderFocus(lines, (index) => virtualizer.scrollToIndex(index));

  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const width = lead + columns.length;

  return (
    <tbody onKeyDown={focus.onKeyDown}>
      {before > 0 && <Spacer height={before} width={width} />}
      {items.map((item) => {
        const line = lines[item.index];
        if (line === undefined) return null;
        const { index } = item;
        const measure = virtualizer.measureElement;
        if (line.kind === 'row') return renderRow(line.row, { index, measure });
        if (line.kind === 'new') {
          return (
            onNew !== undefined && (
              <NewLine
                key={`new${line.chain.at(-1)?.id ?? ''}`}
                line={line}
                index={index}
                measure={measure}
                width={width}
                label={newLabel}
                onNew={onNew}
              />
            )
          );
        }
        return (
          <GroupHeader
            key={line.group.id}
            line={line}
            index={index}
            measure={measure}
            columns={columns}
            lead={lead}
            noun={noun}
            onToggle={() => onToggle(line.group.id)}
            buttonRef={focus.refFor(line.group.id)}
          />
        );
      })}
      {after > 0 && <Spacer height={after} width={width} />}
    </tbody>
  );
}

/** Room for the lines scrolled out of the page, so the scrollbar stays true. */
function Spacer({ height, width }: { height: number; width: number }) {
  return (
    <tr aria-hidden="true" className="table__spacer">
      <td colSpan={width} style={{ height }} />
    </tr>
  );
}

function GroupHeader({
  line,
  index,
  measure,
  columns,
  lead,
  noun,
  onToggle,
  buttonRef,
}: {
  line: Extract<GroupLine, { kind: 'group' }>;
  index: number;
  measure: LinePlace['measure'];
  columns: readonly SummaryColumn[];
  lead: number;
  noun: string;
  onToggle: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const { group, depth, collapsed } = line;
  const count = group.rows.length;
  return (
    <tr className={`table__group table__group--depth-${depth}`} ref={measure} data-index={index}>
      <td colSpan={lead + 1} className="table__group-cell">
        <button
          ref={buttonRef}
          type="button"
          className="table__group-toggle"
          aria-expanded={!collapsed}
          data-depth={depth}
          onClick={onToggle}
        >
          <Icon
            name="chevron"
            size={14}
            className={collapsed ? 'table__fold table__fold--shut' : 'table__fold'}
          />
          {group.tone === null || group.value === null ? (
            <span className="table__group-label">{group.label}</span>
          ) : (
            <StatusPill value={group.label} tone={group.tone} />
          )}
          <span className="table__group-count" aria-label={countLabel({ count, noun })}>
            {count}
          </span>
        </button>
      </td>
      {columns.slice(1).map((column) => {
        const summary = columnSummary({ rows: group.rows, key: column.key, kind: column.kind });
        return (
          <td key={column.key} className="table__summary">
            {summary}
          </td>
        );
      })}
    </tr>
  );
}

function NewLine({
  line,
  index,
  measure,
  width,
  label,
  onNew,
}: {
  line: Extract<GroupLine, { kind: 'new' }>;
  index: number;
  measure: LinePlace['measure'];
  width: number;
  label: string;
  onNew: (chain: readonly RowGroup[]) => void;
}) {
  const where = line.chain.map((group) => group.label).join(' · ');
  return (
    <tr className="table__group-new" ref={measure} data-index={index}>
      <td colSpan={width}>
        <button
          type="button"
          className="table__new table__new--group"
          data-depth={line.depth}
          aria-label={`${label} in ${where}`}
          onClick={() => onNew(line.chain)}
        >
          <Icon name="plus" size={14} />
          {label}
        </button>
      </td>
    </tr>
  );
}

/**
 * Up and Down from a header move to the header above or below it, scrolling
 * it into the page first when the virtualiser has not drawn it yet.
 */
function useHeaderFocus(lines: readonly GroupLine[], scrollTo: (index: number) => void) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  /** A header asked for the focus before the virtualiser had drawn it. */
  const wanted = useRef<string | null>(null);
  const focusDrawn = (id: string): boolean => {
    const button = buttons.current.get(id);
    button?.focus();
    return button !== undefined;
  };

  // Finishes a move to a header that was not drawn when it was asked for: the
  // scroll puts it in the page, that renders, and this focuses it. On every
  // render, as the vault tree's is — there is only whether it has appeared yet.
  useEffect(() => {
    if (wanted.current !== null && focusDrawn(wanted.current)) wanted.current = null;
  });

  const refFor = (id: string) => (element: HTMLButtonElement | null) => {
    if (element === null) buttons.current.delete(id);
    else buttons.current.set(id, element);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const from = lines.findIndex(
      (line) => line.kind === 'group' && buttons.current.get(line.group.id) === event.target,
    );
    if (from === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    for (let at = from + step; at >= 0 && at < lines.length; at += step) {
      const line = lines[at];
      if (line?.kind === 'group') {
        if (!focusDrawn(line.group.id)) {
          scrollTo(at);
          wanted.current = line.group.id;
        }
        return;
      }
    }
  };

  return { refFor, onKeyDown };
}
