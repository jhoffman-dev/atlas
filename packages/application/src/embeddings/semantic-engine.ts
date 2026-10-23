import { CHUNKER_VERSION } from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { NoteChangeNews } from '../index/note-changes.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import {
  createEmbeddingBuild,
  type BuildProgress,
  type EmbeddingBuild,
} from './embedding-build.ts';
import type { EmbeddingCachePort, EmbeddingPort, IdlePort } from './ports.ts';
import { createSemanticBlocks, type SemanticBlocks } from './semantic-blocks.ts';
import { semanticSearch, type SemanticSearch } from './semantic-search.ts';

/** What the cache's vectors were made by: the chunking rules; the host adds the model. */
export const EMBEDDING_GENERATION = `chunks-${CHUNKER_VERSION}`;

const NOT_STARTED: BuildProgress = { done: 0, total: 0, failure: null };

/**
 * Whether semantic search has been used in a vault on this Mac, so its cache
 * is kept up from the next launch on. Until it is first used nothing is
 * built: the first use fetches a 91 MB model (ADR-0031), which is the user's
 * to ask for.
 */
export interface SemanticOptIn {
  isOn(vault: string): boolean;
  turnOn(vault: string): void;
}

export interface SemanticEngineDeps {
  readonly vault: string;
  readonly fs: Pick<VaultFsPort, 'readNotes'>;
  readonly markdown: MarkdownPort;
  readonly index: Pick<IndexPort, 'manifest'>;
  readonly embedder: EmbeddingPort;
  readonly cache: EmbeddingCachePort;
  readonly idle: IdlePort;
  readonly optIn: SemanticOptIn;
  readonly onProgress?: (progress: BuildProgress) => void;
}

/**
 * Semantic search in one vault, with the build that keeps its cache up
 * (P32-02). Nothing is opened, read or embedded until `start` — called by
 * the first search, or at launch in a vault where it was used before.
 */
export interface SemanticEngine extends SemanticSearch {
  /**
   * Opens and loads the cache, if not yet, and queues the work between it
   * and the index's notes. Call again whenever the index has been rebuilt:
   * a rebuild's first sync is not news (`NoteChanges`).
   */
  start(): Promise<void>;
  /** Hands the build a sync's changes; ignored before `start` and for another vault. */
  hear(news: NoteChangeNews): void;
  progress(): BuildProgress;
  /** Told each time the build's progress moves — a write landed, it failed or it finished. */
  subscribe(listener: (progress: BuildProgress) => void): () => void;
  /** Resolves once the build has nothing queued, has failed, or was stopped. */
  settled(): Promise<void>;
  /** Stops the build for good: the vault is closing. */
  stop(): void;
}

export function createSemanticEngine(deps: SemanticEngineDeps): SemanticEngine {
  let opened: Promise<{ blocks: SemanticBlocks; build: EmbeddingBuild }> | null = null;
  let build: EmbeddingBuild | null = null;
  let stopped = false;
  const listeners = new Set<(progress: BuildProgress) => void>();
  const onProgress = (progress: BuildProgress) => {
    deps.onProgress?.(progress);
    for (const listener of listeners) listener(progress);
  };

  const open = async () => {
    const { fresh } = await deps.cache.open({ generation: EMBEDDING_GENERATION });
    const blocks = createSemanticBlocks(
      fresh ? { notes: [], blocks: [] } : await deps.cache.load(),
    );
    build = createEmbeddingBuild({ ...deps, blocks, onProgress });
    if (stopped) build.stop();
    return { blocks, build };
  };
  const opening = () => {
    opened ??= open().catch((cause: unknown) => {
      // The next start tries again: a cache that would not open now may later.
      opened = null;
      throw cause;
    });
    return opened;
  };
  const progress = () => build?.progress() ?? NOT_STARTED;
  const start = async () => {
    deps.optIn.turnOn(deps.vault);
    const { build: started } = await opening();
    const manifest = await deps.index.manifest();
    started.plan(new Map(manifest.map((entry) => [entry.path, entry.digest])));
  };

  return {
    start,
    hear(news) {
      if (news.vault === deps.vault) build?.hear(news.changes);
    },
    async search(asked) {
      if (opened === null) await start();
      const { blocks, build: started } = await opening();
      started.resume();
      return semanticSearch(
        { blocks, embedder: deps.embedder, cache: deps.cache, progress },
        asked,
      );
    },
    progress,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settled: async () => {
      await build?.settled();
    },
    stop() {
      stopped = true;
      build?.stop();
    },
  };
}
