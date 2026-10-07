import { useCallback, useEffect, useMemo, useState } from 'react';
import { matchingCommands, toSearchQuery, type PaletteCommand } from '@atlas/domain';
import { searchNotes, type IndexPort, type SearchHit } from '@atlas/application';

const LIMIT = 20;

const NO_COMMANDS: readonly PaletteCommand[] = [];
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
}: {
  index: IndexPort;
  commands?: readonly PaletteCommand[];
  /** Commands the query itself calls for — a pasted link, say — listed first. */
  offerFor?: (query: string) => readonly PaletteCommand[];
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    const prepared = toSearchQuery(query);
    if (prepared === null) {
      setHits([]);
      return;
    }

    let cancelled = false;
    searchNotes({ index, query: prepared, limit: LIMIT, includeArchived })
      .then((found) => {
        if (!cancelled) {
          setHits(found);
          setSelected(0);
        }
      })
      .catch(() => {
        // A half-typed query the index cannot parse yet simply matches nothing.
        if (!cancelled) setHits([]);
      });

    return () => {
      cancelled = true;
    };
  }, [index, query, includeArchived]);

  const offered = useMemo(
    () => [...offerFor(query), ...matchingCommands(query, commands)],
    [query, commands, offerFor],
  );
  const count = offered.length + hits.length;

  const move = useCallback(
    (delta: number) =>
      setSelected((current) => (count === 0 ? 0 : (current + delta + count) % count)),
    [count],
  );

  const reset = useCallback(() => {
    setQuery('');
    setHits([]);
    setSelected(0);
    setIncludeArchived(false);
  }, []);

  const changeQuery = useCallback((next: string) => {
    setQuery(next);
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
    setIncludeArchived,
  };
}
