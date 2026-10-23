import { toSearchQuery } from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import { searchNotes } from '../index/search-notes.ts';
import type { FoundPassages, PassageFinder, PassageQuestion } from './ports.ts';

/**
 * The most hits one question asks the index for. Search ranks the whole
 * vault, so the notes `within` are found among its hits; past this many, a
 * note ranked lower is not found.
 */
export const PASSAGE_SEARCH_CAP = 2000;

/** The first hits a question asks for; doubled until enough of `within` are found. */
const FIRST_ASK = 100;

/**
 * {@link PassageFinder} by full-text search (ADR-0016's `/v1/search`): the
 * notes of `within` the index ranks for `about`, best first. Search finds
 * notes, not blocks, so no block is named. The Archive is left out, as a
 * page's meetings leave it out. Search ranks the whole vault, so it is asked
 * for more until every note of `within` that holds `about` is among the
 * hits, the hits end, or {@link PASSAGE_SEARCH_CAP} is reached — and the
 * answer says which, so a note ranked below the cap is not taken for absent.
 */
export function indexPassageFinder(index: IndexPort): PassageFinder {
  return {
    async find({ about, within, limit }: PassageQuestion): Promise<FoundPassages> {
      const query = toSearchQuery(about);
      if (query === null || within.length === 0) return { passages: [], complete: true };
      const wanted = new Set(within);
      const enough = Math.min(limit, wanted.size);
      for (let asked = FIRST_ASK; ; asked = Math.min(asked * 2, PASSAGE_SEARCH_CAP)) {
        const hits = await searchNotes({ index, query, limit: asked, includeArchived: false });
        const found = hits.filter((hit) => wanted.has(hit.path));
        const hitsEnded = hits.length < asked;
        if (found.length >= enough || hitsEnded || asked === PASSAGE_SEARCH_CAP) {
          return {
            passages: found.slice(0, limit).map((hit) => ({ path: hit.path, blocks: null })),
            complete: found.length <= limit && (hitsEnded || found.length === wanted.size),
          };
        }
      }
    },
  };
}
