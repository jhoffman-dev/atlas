import { invoke } from '@tauri-apps/api/core';
import type { VaultPath } from '@atlas/domain';
import type {
  IndexedNote,
  IndexEntry,
  IndexOpening,
  IndexPort,
  IndexStats,
  QueryResult,
  SearchHit,
  SearchScope,
  ViewTypeSpec,
} from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/** The SQLite-backed index living in the vault's cache directory. */
export const tauriIndex: IndexPort = {
  open() {
    return throughHost(invoke<IndexOpening>('index_open'));
  },

  async clear() {
    await throughHost(invoke('index_clear'));
  },

  manifest() {
    return throughHost(invoke<IndexEntry[]>('index_manifest'));
  },

  async put(notes: readonly IndexedNote[]) {
    await throughHost(invoke('index_put', { notes }));
  },

  async remove(paths: readonly VaultPath[]) {
    await throughHost(invoke('index_remove', { paths }));
  },

  search(query: string, limit: number, scope: SearchScope = {}) {
    return throughHost(
      invoke<SearchHit[]>('index_search', { query, limit, skipPrefix: scope.skipPrefix ?? null }),
    );
  },

  notesOfType(type: string) {
    return throughHost(invoke<{ path: string; title: string }[]>('index_notes_of_type', { type }));
  },

  async rebuildViews(types: readonly ViewTypeSpec[]) {
    await throughHost(invoke('index_rebuild_views', { types }));
  },

  query(sql: string, parameters: readonly (string | number | null)[]) {
    return throughHost(invoke<QueryResult>('index_query', { sql, parameters }));
  },

  backlinks(path: VaultPath) {
    return throughHost(invoke<string[]>('index_backlinks', { path }));
  },

  stats() {
    return throughHost(invoke<IndexStats>('index_stats'));
  },
};
