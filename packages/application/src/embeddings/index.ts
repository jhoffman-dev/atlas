export { EmbeddingError } from './ports.ts';
export type {
  BlockKey,
  CachedBlock,
  CachedEmbeddings,
  CachedNote,
  EmbeddingCachePort,
  EmbeddingPort,
  EmbeddingPurpose,
  EmbeddingRefusalReason,
  IdlePort,
  NoteToCache,
  RefusedText,
} from './ports.ts';
export { createEmbeddingBuild } from './embedding-build.ts';
export type { BuildProgress, EmbeddingBuild, EmbeddingBuildDeps } from './embedding-build.ts';
export { createSemanticBlocks } from './semantic-blocks.ts';
export type { HeldNote, RankableBlocks, SemanticBlocks } from './semantic-blocks.ts';
export { SEMANTIC_HITS, semanticSearch } from './semantic-search.ts';
export type {
  SemanticAnswer,
  SemanticHit,
  SemanticQuery,
  SemanticSearch,
  SemanticSearchDeps,
} from './semantic-search.ts';
export { createSemanticEngine, EMBEDDING_GENERATION } from './semantic-engine.ts';
export type { SemanticEngine, SemanticEngineDeps, SemanticOptIn } from './semantic-engine.ts';
