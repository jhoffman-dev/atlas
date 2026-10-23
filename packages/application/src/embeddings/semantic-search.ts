import {
  blockLink,
  createVaultPath,
  createWikiLinkResolver,
  isArchivedPath,
  topByCosine,
} from '@dfai/domain';
import type { BuildProgress } from './embedding-build.ts';
import { EmbeddingError, type EmbeddingCachePort, type EmbeddingPort } from './ports.ts';
import type { SemanticBlocks } from './semantic-blocks.ts';

/** How many hits a search gives when it is not told, and the most it ever gives. */
export const SEMANTIC_HITS = { fallback: 20, max: 100 } as const;

/** A question asked of the vault by meaning. */
export interface SemanticQuery {
  /** Words, in any phrasing: "when does Mara get paid" finds "pay day moves to Friday". */
  readonly query: string;
  /** At most this many hits; `SEMANTIC_HITS.fallback` when not said, never more than `.max`. */
  readonly limit?: number;
  /** The Archive's notes too; left out unless asked for, as the word search leaves them (U-22). */
  readonly includeArchived?: boolean;
}

/** One block that answers a question, with the link that cites it. */
export interface SemanticHit {
  readonly path: string;
  /** The note's title. */
  readonly title: string;
  /** What the block says, cut to an excerpt. */
  readonly text: string;
  /** The heading the block sits under, or null. */
  readonly heading: string | null;
  /** The block's `^id` when it has one; a hit opens there. */
  readonly block: string | null;
  /** `[[Note#^id]]`, else `[[Note#Heading]]`, else `[[Note]]` (ADR-0022): what an answer cites. */
  readonly link: string;
  /** Cosine similarity to the question, from -1 to 1: higher is closer. */
  readonly score: number;
}

/** The blocks closest to a question, best first, and how much of the vault they were found among. */
export interface SemanticAnswer {
  readonly hits: readonly SemanticHit[];
  /**
   * The build's progress as the search ran: while `done < total`, notes not
   * yet embedded could not be found, and an answer may be missing them.
   */
  readonly progress: BuildProgress;
}

/** Semantic search over one vault, as the palette, the API and the assistant ask it. */
export interface SemanticSearch {
  search(asked: SemanticQuery): Promise<SemanticAnswer>;
}

export interface SemanticSearchDeps {
  readonly blocks: SemanticBlocks;
  readonly embedder: EmbeddingPort;
  readonly cache: Pick<EmbeddingCachePort, 'excerpts'>;
  readonly progress: () => BuildProgress;
}

/**
 * The blocks most like the question, by cosine over every block in the cache
 * (ADR-0031): the question is embedded as a query, which the model reads
 * differently from a passage, and compared with each block's vector. A
 * question with nothing the model can read finds nothing; one too long for
 * it is refused, as an `EmbeddingError`.
 */
export async function semanticSearch(
  deps: SemanticSearchDeps,
  asked: SemanticQuery,
): Promise<SemanticAnswer> {
  const query = asked.query.trim();
  const limit = Math.min(Math.max(0, asked.limit ?? SEMANTIC_HITS.fallback), SEMANTIC_HITS.max);
  if (query === '' || limit === 0) return { hits: [], progress: deps.progress() };
  const vector = await queryVector(deps.embedder, query);
  if (vector === null) return { hits: [], progress: deps.progress() };

  const { blocks, vectors } = deps.blocks.rankable();
  const reach =
    asked.includeArchived === true
      ? () => true
      : (at: number) => !isArchivedPath((blocks[at] as { path: string }).path);
  const ranked = topByCosine({ query: vector, vectors, limit, include: reach });
  const found = ranked.map(({ at, score }) => ({
    block: blocks[at] as (typeof blocks)[number],
    score,
  }));
  const excerpts = await deps.cache.excerpts(found.map(({ block }) => block));
  const resolve = createWikiLinkResolver(deps.blocks.paths().map(createVaultPath));
  const hits = found.map(({ block, score }, at): SemanticHit => ({
    path: block.path,
    title: deps.blocks.note(block.path)?.title ?? block.path,
    text: excerpts[at] ?? '',
    heading: block.heading,
    block: block.anchor,
    link: blockLink({
      path: createVaultPath(block.path),
      anchor: block.anchor,
      heading: block.heading,
      resolve,
    }),
    score,
  }));
  return { hits, progress: deps.progress() };
}

/** The question's vector; null when the model finds nothing in it to read. */
async function queryVector(embedder: EmbeddingPort, query: string): Promise<Float32Array | null> {
  try {
    const [vector] = await embedder.embed({ texts: [query], purpose: 'query' });
    return vector ?? null;
  } catch (cause) {
    const reason = cause instanceof EmbeddingError ? cause.refused?.reason : undefined;
    if (reason === 'nothing-readable' || reason === 'unreadable-run') return null;
    throw cause;
  }
}
