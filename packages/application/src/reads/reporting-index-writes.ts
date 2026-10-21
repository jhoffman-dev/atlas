import { facetsChangedBetween, INDEX_FACETS, type FacetRow, type IndexFacet } from '@dfai/domain';
import type { IndexedNote, IndexPort } from '../index/ports.ts';
import { readNoteFacets } from './index-facets.ts';

/** A put being checked, and the notes of every put that ran while it did. */
interface Checking {
  readonly notes: readonly IndexedNote[];
  readonly alongside: IndexedNote[];
}

/**
 * The same index, saying after each write which facets it changed, so a
 * whole-vault read is made again only when what it is made from moved (#259).
 * A put is checked by asking the index what it held of those notes before and
 * after; a removal or a clear changes every facet. A write that fails may
 * have written part of itself, so it changes every facet too. A put made
 * while every facet is already to be read again is not checked: nothing it
 * could say would change that.
 *
 * The index syncer puts one batch at a time, so checks do not overlap there.
 * Should two overlap anyway, each one's "before" and "after" can miss what
 * the other wrote in between, and a reader may have seen it: each then says
 * every facet any of their rows could have shown (`hiddenByOverlap`).
 */
export function reportingIndexWrites({
  index,
  report,
  stale = () => new Set(),
}: {
  index: IndexPort;
  /** Told of every write that changed a facet, with the facets it changed. */
  report: (facets: ReadonlySet<IndexFacet>) => void;
  /** The facets already to be read again, from writes reported before. */
  stale?: () => ReadonlySet<string>;
}): IndexPort {
  const every = () => report(new Set(INDEX_FACETS));
  const reportingFailure = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (cause) {
      every();
      throw cause;
    }
  };
  const checking = new Set<Checking>();
  const begin = (notes: readonly IndexedNote[]): Checking => {
    const check: Checking = { notes, alongside: [] };
    for (const other of checking) {
      other.alongside.push(...notes);
      check.alongside.push(...other.notes);
    }
    checking.add(check);
    return check;
  };
  return {
    ...index,
    async put(notes, scope) {
      const due = stale();
      if (notes.length === 0 || INDEX_FACETS.every((facet) => due.has(facet))) {
        return index.put(notes, scope);
      }
      const paths = notes.map((note) => note.path);
      const check = begin(notes);
      try {
        const before = await readNoteFacets({ index, paths });
        await reportingFailure(() => index.put(notes, scope));
        const after = before === null ? null : await readNoteFacets({ index, paths });
        const changed = new Set(facetsChangedBetween({ paths, before, after }));
        for (const facet of hiddenByOverlap(check, [...(before ?? []), ...(after ?? [])])) {
          changed.add(facet);
        }
        if (changed.size > 0) report(changed);
      } finally {
        checking.delete(check);
      }
    },
    async remove(paths, scope) {
      await reportingFailure(() => index.remove(paths, scope));
      if (paths.length > 0) every();
    },
    async clear() {
      await reportingFailure(() => index.clear());
      every();
    },
  };
}

/**
 * What a put that overlapped another may have hidden: the graph always (every
 * note has a title row), and the tags when any of the notes either put wrote,
 * or what the index held of them, has a tag.
 */
function hiddenByOverlap(check: Checking, held: readonly FacetRow[]): IndexFacet[] {
  if (check.alongside.length === 0) return [];
  const written = [...check.notes, ...check.alongside];
  const tagged =
    written.some((note) => note.tags.length > 0) || held.some((row) => row.facet === 'tags');
  return tagged ? ['graph', 'tags'] : ['graph'];
}
