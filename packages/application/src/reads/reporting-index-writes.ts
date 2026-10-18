import { facetsChangedBetween, INDEX_FACETS, type IndexFacet } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { readNoteFacets } from './index-facets.ts';

/**
 * The same index, saying after each write which facets it changed, so a
 * whole-vault read is made again only when what it is made from moved (#259).
 * A put is checked by asking the index what it held of those notes before and
 * after; a removal or a clear changes every facet. A write that fails may
 * have written part of itself, so it changes every facet too. A put made
 * while every facet is already to be read again is not checked: nothing it
 * could say would change that.
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
  return {
    ...index,
    async put(notes, scope) {
      const due = stale();
      if (notes.length === 0 || INDEX_FACETS.every((facet) => due.has(facet))) {
        return index.put(notes, scope);
      }
      const paths = notes.map((note) => note.path);
      const before = await readNoteFacets({ index, paths });
      await reportingFailure(() => index.put(notes, scope));
      const changed = facetsChangedBetween({
        paths,
        before,
        after: before === null ? null : await readNoteFacets({ index, paths }),
      });
      if (changed.size > 0) report(changed);
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
