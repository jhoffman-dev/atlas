import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchingCommands, toSearchQuery, type PaletteCommand } from '@dfai/domain';
import { searchNotes, type IndexPort, type SearchHit } from '@dfai/application';
import { withArchived, withMoved, withQuery } from '../overlay.ts';
import { changePalette, usePaletteInput, type OverlayStore } from '../overlay-store.ts';

const LIMIT = 20;

const NO_COMMANDS: readonly PaletteCommand[] = [];
const NO_HITS: readonly SearchHit[] = [];
/** Hits, and the search they answered: `includeArchived:query`. */
interface Answer {
  readonly asked: string;
  readonly hits: readonly SearchHit[];
}
const NO_ANSWER: Answer = { asked: '', hits: NO_HITS };
/**
 * The index being built — a vault's first sync, or a rebuild: searched now, it
 * answers from half of it (#135). A refresh keeps the index ready (#238).
 */
const BUILDING = 'building';
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
  store,
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
  /** Where the query and the chosen row are kept (#261). */
  store: OverlayStore;
}) {
  const { query, selected, includeArchived } = usePaletteInput(store);
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER);
  const prepared = toSearchQuery(query);
  const asking = prepared === null ? '' : `${String(includeArchived)}:${prepared}`;
  // Only hits that answered the search on screen are shown: while a query typed
  // during a build waits, the last query's hits are not this one's to open.
  const hits = answer.asked === asking ? answer.hits : NO_HITS;
  // Searched again once per settled index, never while it is being written,
  // and not at all for an empty query: the palette shut asks nothing.
  const searchKey =
    prepared === null ? null : changeKey === BUILDING ? BUILDING : (changeKey ?? '');
  // What the hits on screen answered, and which one is chosen, for a search run
  // again only because the index moved: it keeps the person's place.
  const shown = useRef({ asked: '', hits: NO_HITS, selected: 0, ahead: 0 });

  useEffect(() => {
    if (prepared === null) {
      setAnswer(NO_ANSWER);
      return;
    }
    if (searchKey === BUILDING) return;

    let cancelled = false;
    const asked = asking;
    // The highlights in literature notes too, after the notes, each opening at its block (#507).
    searchNotes({ index, query: prepared, limit: LIMIT, includeArchived, highlights: true })
      .then((found) => {
        if (cancelled) return;
        const was = shown.current;
        setAnswer({ asked, hits: found });
        // The place is kept only for the same search answered again.
        const place = was.asked === asked ? keptPlace(was, found) : 0;
        changePalette(store, (input) => ({ ...input, selected: place }));
      })
      .catch(() => {
        // A half-typed query the index cannot parse yet simply matches nothing.
        if (!cancelled) setAnswer({ asked, hits: NO_HITS });
      });

    return () => {
      cancelled = true;
    };
  }, [index, prepared, includeArchived, asking, searchKey, store]);

  const offered = useMemo(
    () => [...offerFor(query), ...matchingCommands(query, commands)],
    [query, commands, offerFor],
  );
  const count = offered.length + hits.length;
  useEffect(() => {
    // The search the hits on screen answered, not the query typed since.
    shown.current = {
      asked: hits === NO_HITS ? '' : answer.asked,
      hits,
      selected,
      ahead: offered.length,
    };
  });

  const move = useCallback(
    (delta: number) => changePalette(store, (input) => withMoved(input, delta, count)),
    [store, count],
  );

  const changeQuery = useCallback(
    (next: string) => changePalette(store, (input) => withQuery(input, next)),
    [store],
  );

  const changeArchived = useCallback(
    (next: boolean) => changePalette(store, (input) => withArchived(input, next)),
    [store],
  );

  return {
    query,
    setQuery: changeQuery,
    commands: offered,
    hits,
    selected,
    move,
    /** Archived notes are left out of a search unless this is on (U-22). */
    includeArchived,
    setIncludeArchived: changeArchived,
  };
}

/** Which result a hit is: its note, and its block for a highlight in it. */
const sameHit = (left: SearchHit | undefined, right: SearchHit) =>
  left !== undefined && left.path === right.path && left.block === right.block;

/**
 * Where the chosen result is once the same search is answered again: on the
 * same note (or highlight) if it still matches, else as near its place as the
 * list allows. Commands come first and do not move, since the query has not
 * changed.
 */
function keptPlace(
  was: { readonly hits: readonly SearchHit[]; readonly selected: number; readonly ahead: number },
  found: readonly SearchHit[],
): number {
  if (was.selected < was.ahead) return was.selected;
  const chosen = was.hits[was.selected - was.ahead];
  const at = found.findIndex((hit) => sameHit(chosen, hit));
  if (at >= 0) return was.ahead + at;
  return Math.max(0, Math.min(was.selected, was.ahead + found.length - 1));
}
