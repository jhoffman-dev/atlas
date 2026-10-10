import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  boardGroups,
  drawnLevels,
  calendarEndKey,
  groupChoices,
  groupColumnOptions,
  groupResultRows,
  viewGroupKeys,
  layoutChange,
  layoutChoices,
  parseSavedView,
  parseViewDisplay,
  queryForLayout,
  statusOf,
  toBoardRows,
  type BoardLane,
  type BoardRow,
  type CalendarRange,
  type GroupChoice,
  type LayoutChoice,
  type NoteNames,
  type ObjectType,
  type QueryFilter,
  type QuerySort,
  type RowGroup,
  type StatusProperty,
  type VaultPath,
  type ViewDisplay,
  type ViewEdits,
  type ViewLayout,
  type ViewQuery,
} from '@atlas/domain';
import {
  relationGroupLinks,
  runView,
  type IndexPort,
  type MarkdownPort,
  type OpenNote,
  type VaultFsPort,
  type ViewResult,
  type ActivityLog,
} from '@atlas/application';
import { useNoteNames, type CardAdd, type CardMove, type DoneTicks } from '@atlas/ui';
import type { OpenEditors } from '../panes/open-editors.ts';
import { errorMessage } from './error-message.ts';
import type { TickMemory } from './tick-memory.ts';
import { useCardCreation } from './use-card-creation.ts';
import { useDoneTicks } from './use-done-ticks.ts';
import { useNotePreviews, type NotePreviews } from './use-note-previews.ts';
import { useChangeProperties, useRowWrites } from './use-view-writes.ts';
import { useViewEdits } from './use-view-edits.ts';
import type { ViewDrafts } from './use-view-drafts.ts';

const NO_SORTS: readonly QuerySort[] = [];

/**
 * Runs the open note when that note is a saved view.
 *
 * What is drawn is the view note with the toolbar's unsaved changes laid over
 * it (`useViewEdits`) — its layout among them; editing a row, a card or a date,
 * or ticking a note done, writes that note at once.
 */
export function useSavedView({
  note,
  index,
  fs,
  markdown,
  types,
  notePaths,
  indexKey,
  onChanged,
  editors,
  drafts,
  viewPaths,
  tickMemory,
  activity,
}: {
  note: OpenNote | null;
  index: IndexPort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  types: readonly ObjectType[];
  notePaths: readonly string[];
  /** Changes when the index does, so the table refreshes after an edit. */
  indexKey: string;
  onChanged: () => void;
  /** The panes, so a note one of them holds is written through it. */
  editors: OpenEditors;
  /** Every view's unsaved toolbar changes. */
  drafts: ViewDrafts;
  /** Every saved view, so a new one's name is checked against them. */
  viewPaths: readonly string[];
  /** What ticked notes' statuses were, so unticking can put them back. */
  tickMemory: TickMemory;
  /** Where an edit the view gives up on is recorded. */
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): {
  query: ViewQuery | null;
  display: ViewDisplay;
  /** The type the view lists, when the vault defines it. */
  type: ObjectType | null;
  result: ViewResult | null;
  /** The columns the view asked for — the result may carry more, for a done box. */
  fields: readonly string[];
  /** What the result carries only for the layout's sake, which a table leaves out. */
  hidden: readonly string[];
  rows: readonly BoardRow[];
  /** A board's columns — every value, even one no card has yet — and a gallery's groups. */
  columns: readonly RowGroup[];
  /** A board's swimlanes, when the view sub-groups. */
  lanes: readonly BoardLane[];
  /** A table's groups and their sub-groups: only the values some row has. */
  groups: readonly RowGroup[];
  /** What the Group control offers, each with why it cannot be chosen when it cannot. */
  groupChoices: readonly GroupChoice[];
  error: string | null;
  editCell: (args: { path: string; column: string; value: string }) => void;
  toggleSort: (column: string) => void;
  setFilters: (filters: readonly QueryFilter[]) => void;
  setSorts: (sorts: readonly QuerySort[]) => void;
  setGroupBy: (groupBy: string | null) => void;
  setSubGroupBy: (subGroupBy: string | null) => void;
  toggleColumn: (key: string) => void;
  moveColumn: (key: string, by: -1 | 1) => void;
  /** Whether archived notes are listed too; they are left out unless asked for. */
  includeArchived: boolean;
  setIncludeArchived: (include: boolean) => void;
  /** Whether the view on screen differs from the view note. */
  edited: boolean;
  save: () => void;
  reset: () => void;
  /** Writes the view as shown to a new view note, and says where. */
  saveAs: (name: string) => Promise<VaultPath | null>;
  saveAsError: string | null;
  moveCard: (move: CardMove) => void;
  reschedule: (args: { path: string; start: string; end: string | null }) => void;
  moveBar: (args: { path: string; start: string; end: string }) => void;
  addCard: (add: CardAdd) => void;
  /** Adds a note under a table's group, given its values, and says where. */
  addInGroup: (chain: readonly RowGroup[]) => Promise<VaultPath | null>;
  /** Adds a note on a calendar's day or at its time, named as typed. */
  addOnDate: (args: { value: string; name: string }) => void;
  /** Adds a note of the view's type — in a board's first column — and says where. */
  addNote: () => Promise<VaultPath | null>;
  /** Every layout, and whether this type can be drawn as it. */
  layouts: readonly LayoutChoice[];
  /** Draws the view another way — an unsaved change, like a filter. */
  setLayout: (layout: ViewLayout) => void;
  /** Shows a calendar as a month, a week, 3 days, a day or an agenda — an unsaved change, like a layout. */
  setCalendarRange: (range: CalendarRange) => void;
  /** The done boxes, for a type whose status has a done option. */
  ticks: DoneTicks | undefined;
  /** What a feed and a gallery show of each note beyond its fields. */
  previews: NotePreviews;
} {
  // Held with the view it was turned on in, so the next view opens without it.
  const [archivedIn, setArchivedIn] = useState<string | null>(null);
  const includeArchived = archivedIn !== null && archivedIn === note?.path;
  const setIncludeArchived = useCallback(
    (include: boolean) => setArchivedIn(include ? (note?.path ?? null) : null),
    [note?.path],
  );
  const shownView = useShownView({
    note,
    index,
    indexKey,
    includeArchived,
    drafts,
    viewPaths,
    fs,
    markdown,
    editors,
    onChanged,
    types,
    activity,
  });
  const { result, error, setError, query, display, type, status, hidden, fields } = shownView;
  const { applyEdits, ...viewEdits } = shownView.edits;
  const { rows, columns, lanes, groups, groupOptions } = useViewShape({
    type,
    display,
    sorts: query?.sorts ?? NO_SORTS,
    result,
    index,
    indexKey,
  });
  const choices = useMemo(() => groupChoices(type), [type]);

  const changeProperties = useChangeProperties({
    editors,
    fs,
    markdown,
    activity,
    onChanged,
    onError: setError,
  });
  const rowWrites = useRowWrites({ display, type, groupOptions, status, changeProperties });
  const layouts = useMemo(() => (type === null ? [] : layoutChoices(type)), [type]);
  const setLayout = useLayoutEdit({ display, type, status, applyEdits });
  const setCalendarRange = useCallback(
    (calendarRange: CalendarRange) => applyEdits({ calendarRange }),
    [applyEdits],
  );
  const ticks = useDoneTicks({ status, rows, memory: tickMemory, changeProperties });
  const previews = useNotePreviews({
    fs,
    markdown,
    rows,
    layout: display.layout,
    viewKey: note?.path ?? '',
    indexKey,
    type,
  });
  const creation = useCardCreation({
    fs,
    markdown,
    query,
    type,
    groupBy: display.groupBy,
    subGroupBy: display.subGroupBy,
    dateKey: display.dateKey,
    groupOptions,
    notePaths,
    activity,
    onChanged,
    onError: setError,
  });

  return {
    query,
    display,
    type,
    result,
    includeArchived,
    setIncludeArchived,
    fields,
    hidden,
    rows,
    columns,
    lanes,
    groups,
    groupChoices: choices,
    error,
    ...viewEdits,
    ...rowWrites,
    ...creation,
    layouts,
    setLayout,
    setCalendarRange,
    ticks,
    previews,
  };
}

/**
 * Choosing a layout from the toolbar: an unsaved change like a filter, which
 * Save view writes and Reset drops — with the property the layout needs when
 * the view does not name one yet. A layout the type cannot draw changes nothing.
 */
function useLayoutEdit({
  display,
  type,
  status,
  applyEdits,
}: {
  display: ViewDisplay;
  type: ObjectType | null;
  status: StatusProperty | null;
  applyEdits: (edits: ViewEdits) => void;
}) {
  return useCallback(
    (layout: ViewLayout) => {
      if (type === null) return;
      const edits = layoutChange({ layout, display, type, statusKey: status?.key ?? null });
      if (edits !== null) applyEdits(edits);
    },
    [display, type, status, applyEdits],
  );
}

/**
 * The view as it is drawn — the note with the toolbar's unsaved changes over
 * it — and its result. Saving writes the view note through the pane holding it.
 */
function useShownView({
  note,
  index,
  indexKey,
  drafts,
  viewPaths,
  fs,
  markdown,
  editors,
  onChanged,
  types,
  includeArchived,
  activity,
}: {
  note: OpenNote | null;
  index: IndexPort;
  indexKey: string;
  includeArchived: boolean;
  drafts: ViewDrafts;
  viewPaths: readonly string[];
  fs: VaultFsPort;
  markdown: MarkdownPort;
  editors: OpenEditors;
  onChanged: () => void;
  types: readonly ObjectType[];
  activity: Pick<ActivityLog, 'inOpenVault'>;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const changeView = useChangeProperties({
    editors,
    fs,
    markdown,
    activity,
    onChanged,
    onError: setSaveError,
  });
  const edits = useViewEdits({
    note,
    drafts,
    changeProperties: changeView,
    fs,
    markdown,
    viewPaths,
    activity,
    onChanged,
  });
  const query = useMemo(
    () => (note === null ? null : parseSavedView(edits.shown)),
    [note, edits.shown],
  );
  const display = useMemo(() => parseViewDisplay(edits.shown), [edits.shown]);
  const type = useMemo(
    () =>
      query === null ? null : (types.find((candidate) => candidate.name === query.type) ?? null),
    [types, query],
  );
  const status = useMemo(() => statusOf(type), [type]);
  // The query as this layout runs it: with the status a done box reads, and a
  // feed's newest-first order. The saved query — and the Sort control — are unchanged.
  const layoutRun = useMemo(
    () =>
      query === null
        ? null
        : queryForLayout({
            query,
            layout: display.layout,
            statusKey: status?.key ?? null,
            endKey:
              display.dateKey === null
                ? null
                : calendarEndKey({ ...display, dateKey: display.dateKey }),
            groupKeys: viewGroupKeys({
              type,
              groupBy: display.groupBy,
              subGroupBy: display.subGroupBy,
            }),
          }),
    [query, display, status, type],
  );
  const run = useViewResult({
    index,
    query: layoutRun?.query ?? null,
    indexKey,
    includeArchived,
  });
  const hidden = useMemo(() => layoutRun?.hidden ?? [], [layoutRun]);
  const fields = useMemo(
    () => (run.result?.columns ?? []).filter((column) => !hidden.includes(column)),
    [run.result, hidden],
  );
  return {
    ...run,
    error: run.error ?? saveError,
    query,
    display,
    type,
    status,
    hidden,
    fields,
    edits,
  };
}

/** The view run against the index, again whenever the index changes. */
function useViewResult({
  index,
  query,
  indexKey,
  includeArchived,
}: {
  index: IndexPort;
  query: ViewQuery | null;
  indexKey: string;
  includeArchived: boolean;
}) {
  const [result, setResult] = useState<ViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query === null) {
      setResult(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);
    runView({ index, query, includeArchived })
      .then((found) => {
        if (!cancelled) setResult(found);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult(null);
          setError(errorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [index, query, indexKey, includeArchived]);

  return { result, error, setError };
}

/**
 * The result as rows, and in its groups: a table's groups and sub-groups, a
 * board's columns and swimlanes — one grouping model, the one a query's
 * GROUP BY … THEN uses, in the order the type declares a select's options.
 */
function useViewShape({
  type,
  display,
  sorts,
  result,
  index,
  indexKey,
}: {
  type: ObjectType | null;
  display: ViewDisplay;
  sorts: readonly QuerySort[];
  result: ViewResult | null;
  index: IndexPort;
  indexKey: string;
}) {
  const rows = useMemo(
    () => (result === null ? [] : toBoardRows({ columns: result.columns, rows: result.rows })),
    [result],
  );
  const names = useNoteNames();
  const related = useRelatedOptions({ type, display, index, indexKey, names });

  /** The values the grouping property declares, so columns read in workflow order. */
  const groupOptions = useMemo(
    () => groupColumnOptions(type, display.groupBy),
    [type, display.groupBy],
  );

  // The levels the layout draws — a gallery only its first, as its columns —
  // by the rule the API answers and moves cards by.
  const { layout, groupBy, subGroupBy } = display;
  const levels = useMemo(
    () => drawnLevels({ display: { layout, groupBy, subGroupBy }, type, sorts, related }),
    [type, layout, groupBy, subGroupBy, sorts, related],
  );
  const table = display.layout === 'table';
  const board = useMemo(
    () => (table ? { columns: [], lanes: [] } : boardGroups({ rows, levels, names })),
    [table, rows, levels, names],
  );
  const groups = useMemo(
    () => (table ? groupResultRows({ rows, groups: levels, names }) : []),
    [table, rows, levels, names],
  );

  return { rows, columns: board.columns, lanes: board.lanes, groups, groupOptions };
}

/**
 * For each grouping level that is a relation, every note it can point at —
 * so a board grouped by project has a column (or a lane) for each project.
 */
function useRelatedOptions({
  type,
  display,
  index,
  indexKey,
  names,
}: {
  type: ObjectType | null;
  display: ViewDisplay;
  index: IndexPort;
  indexKey: string;
  names: NoteNames;
}): Readonly<Record<string, readonly string[]>> {
  const targetOf = (key: string | null) => {
    const property = type?.properties.find((candidate) => candidate.key === key);
    return property?.kind === 'relation' ? property.target : null;
  };
  const first = useRelatedNotes({ index, target: targetOf(display.groupBy), indexKey, names });
  const second = useRelatedNotes({ index, target: targetOf(display.subGroupBy), indexKey, names });
  return useMemo(() => {
    const related: Record<string, readonly string[]> = {};
    if (display.groupBy !== null) related[display.groupBy] = first;
    if (display.subGroupBy !== null) related[display.subGroupBy] = second;
    return related;
  }, [display.groupBy, display.subGroupBy, first, second]);
}

/**
 * Every note a relation can point at, as the link a card in its column would
 * hold — so a board grouped by project has a column for each project, even
 * one with nothing in it yet.
 */
function useRelatedNotes({
  index,
  target,
  indexKey,
  names,
}: {
  index: IndexPort;
  target: string | null;
  indexKey: string;
  /** Links a note the way it is found, not by the title it may give itself. */
  names: NoteNames;
}): readonly string[] {
  const [links, setLinks] = useState<readonly string[]>([]);

  useEffect(() => {
    if (target === null) {
      setLinks([]);
      return;
    }
    let cancelled = false;
    relationGroupLinks({ index, target, names })
      .then((links) => {
        if (!cancelled) setLinks(links);
      })
      .catch(() => {
        // An index that is not ready yet offers no empty columns; the cards
        // still make theirs.
        if (!cancelled) setLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [index, target, indexKey, names]);

  return links;
}
