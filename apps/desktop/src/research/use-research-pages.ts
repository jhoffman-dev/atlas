import { useMemo, useState } from 'react';
import {
  DEFAULT_LIBRARY_SORT,
  filterHighlights,
  highlightChoices,
  libraryChoices,
  libraryShown,
  NO_HIGHLIGHT_FILTER,
  NO_LIBRARY_FILTER,
  type HighlightEntry,
  type HighlightFilter,
  type LibraryEntry,
  type LibraryFilter,
  type LibrarySort,
} from '@dfai/domain';
import type { HighlightsPageProps, LibraryPageProps, ResearchListState } from '@dfai/ui';
import type { ReadState } from '../reads/read-state.ts';

type EntriesRead<Entry> = ReadState<{ readonly entries: readonly Entry[] }>;

/** A read's entries as a page shows them: the ones `shown` lets through, of how many. */
function listState<Entry>(
  read: EntriesRead<Entry>,
  shown: (entries: readonly Entry[]) => readonly Entry[],
): ResearchListState<Entry> {
  if (read.kind !== 'ready') return read;
  return { kind: 'ready', shown: shown(read.entries), total: read.entries.length };
}

const NO_ENTRIES: readonly never[] = [];

const entriesOf = <Entry>(read: EntriesRead<Entry>): readonly Entry[] =>
  read.kind === 'ready' ? read.entries : NO_ENTRIES;

/**
 * The Library's filter and order, kept by the page while it is open, and
 * the sources they show: the domain's rules over what the index read.
 */
export function useLibraryPage(
  read: EntriesRead<LibraryEntry>,
): Pick<LibraryPageProps, 'state' | 'choices' | 'filter' | 'onFilter' | 'sort' | 'onSort'> {
  const [filter, setFilter] = useState<LibraryFilter>(NO_LIBRARY_FILTER);
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_LIBRARY_SORT);
  const state = useMemo(
    () => listState(read, (entries) => libraryShown(entries, { filter, sort })),
    [read, filter, sort],
  );
  const choices = useMemo(() => libraryChoices(entriesOf(read)), [read]);
  return { state, choices, filter, onFilter: setFilter, sort, onSort: setSort };
}

/**
 * All highlights' filter, kept by the page while it is open, and the
 * highlights it shows. "When the source changed" counts back from the
 * clock's `now`, read as the filter changes.
 */
export function useHighlightsPage(
  read: EntriesRead<HighlightEntry>,
  now: () => number,
): Pick<HighlightsPageProps, 'state' | 'choices' | 'filter' | 'onFilter'> {
  const [{ filter, at }, setFiltered] = useState<{ filter: HighlightFilter; at: number }>(() => ({
    filter: NO_HIGHLIGHT_FILTER,
    at: now(),
  }));
  const state = useMemo(
    () => listState(read, (entries) => filterHighlights(entries, filter, at)),
    [read, filter, at],
  );
  const choices = useMemo(() => highlightChoices(entriesOf(read)), [read]);
  const onFilter = useMemo(
    () => (next: HighlightFilter) => setFiltered({ filter: next, at: now() }),
    [now],
  );
  return { state, choices, filter, onFilter };
}
