export { refreshIndex, toIndexedNote } from './refresh-index.ts';
export { syncIndex } from './sync-index.ts';
export type { IndexRefresh, RefreshOptions } from './refresh-index.ts';
export type {
  QueryResult,
  ViewColumnSpec,
  ViewTypeSpec,
  IndexedBlockRow,
  IndexedLinkRow,
  IndexedNote,
  IndexEntry,
  IndexPort,
  IndexStats,
  SearchHit,
  SearchScope,
} from './ports.ts';
export { searchNotes, searchScope } from './search-notes.ts';
