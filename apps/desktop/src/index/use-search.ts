import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchingCommands, toSearchQuery, type PaletteCommand } from '@atlas/domain';
import { searchNotes, type IndexPort, type SearchHit } from '@atlas/application';

const LIMIT = 20;

const NO_COMMANDS: readonly PaletteCommand[] = [];
const NO_HITS: readonly SearchHit[] = [];
/** The index being written: searched now, it answers from half of it (#135). */
const WORKING = 'working';
const noOffers = (): readonly PaletteCommand[] => NO_COMMANDS;

/**
 * Runs a search as the query changes, keeping the selected result in range.
 * The commands the query names come first, and the arrow keys move through
 * them and the notes as one list.
 */
export function useSearch({
  index,
  commands = NO_COMMANDS,
  offerFor = noOffers,
  changeKey,
}: {
  index: IndexPort;
  commands?: readonly PaletteCommand[];
  /** Commands the query itself calls for — a pasted link, say — listed first. */
  offerFor?: (query: string) => readonly PaletteCommand[];
  /**
   * Changes whenever the index does. A note made a moment ago is indexed after
   * it opens, so a search typed in between would otherwise stay empty.
   */
  changeKey?: string;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>(NO_HITS);
  const [selected, setSelected] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const prepared = toSearchQuery(query);
  // Searched again once per settled index, never while it is being written,
  // and not at all for an empty query: the palette shut asks nothing.
  const searchKey = prepared === null ? null : changeKey === WORKING ? WORKING : (changeKey ?? '');
  // What the hits on screen answered, and which one is chosen, for a search run
  // again only because the index moved: it keeps the person's place.
  const shown = useRef({ asked: '', hits: NO_HITS, selected: 0, ahead: 0 });

  useEffect(() => {
    if (prepared === null) {
      setHits(NO_HITS);
      return;
    }
    if (searchKey === WORKING) return;

    let cancelled = false;
    const asked = `${String(includeArchived)}:${prepared}`;
    searchNotes({ index, query: prepared, limit: LIMIT, includeArchived })
      .then((found) => {
        if (cancelled) return;
        const was = shown.current;
        setHits(found);
        setSelected(was.asked === asked ? keptPlace(was, found) : 0);
      })
      .catch(() => {
        // A half-typed query the index cannot parse yet simply matches nothing.
        if (!cancelled) setHits(NO_HITS);
      });

    return () => {
      cancelled = true;
    };
  }, [index, prepared, includeArchived, searchKey]);

  const offered = useMemo(
    () => [...offerFor(query), ...matchingCommands(query, commands)],
    [query, commands, offerFor],
  );
  const count = offered.length + hits.length;
  useEffect(() => {
    shown.current = {
      asked: prepared === null ? '' : `${String(includeArchived)}:${prepared}`,
      hits,
      selected,
      ahead: offered.length,
    };
  });

  const move = useCallback(
    (delta: number) =>
      setSelected((current) => (count === 0 ? 0 : (current + delta + count) % count)),
    [count],
  );

  const reset = useCallback(() => {
    setQuery('');
    setHits(NO_HITS);
    setSelected(0);
    setIncludeArchived(false);
  }, []);

  const changeQuery = useCallback((next: string) => {
    setQuery(next);
    setSelected(0);
  }, []);

  const changeArchived = useCallback((next: boolean) => {
    setIncludeArchived(next);
    setSelected(0);
  }, []);

  return {
    query,
    setQuery: changeQuery,
    commands: offered,
    hits,
    selected,
    move,
    reset,
    /** Archived notes are left out of a search unless this is on (U-22). */
    includeArchived,
    setIncludeArchived: changeArchived,
  };
}

/**
 * Where the chosen result is once the same search is answered again: on the
 * same note if it still matches, else as near its place as the list allows.
 * Commands come first and do not move, since the query has not changed.
 */
function keptPlace(
  was: { readonly hits: readonly SearchHit[]; readonly selected: number; readonly ahead: number },
  found: readonly SearchHit[],
): number {
  if (was.selected < was.ahead) return was.selected;
  const path = was.hits[was.selected - was.ahead]?.path;
  const at = found.findIndex((hit) => hit.path === path);
  if (at >= 0) return was.ahead + at;
  return Math.max(0, Math.min(was.selected, was.ahead + found.length - 1));
}
