export { refreshIndex, toIndexedNote } from './refresh-index.ts';
export { createIndexSyncer } from './sync-index.ts';
export type { IndexSyncer } from './sync-index.ts';
export { createNoteChanges } from './note-changes.ts';
export type { NoteChangeNews, NoteChanges } from './note-changes.ts';
export type { IndexRefresh, RefreshOptions } from './refresh-index.ts';
export type {
  QueryResult,
  ViewColumnSpec,
  ViewTypeSpec,
  IndexedBlockRow,
  IndexedCheckRow,
  IndexedLinkRow,
  IndexedNote,
  IndexEntry,
  IndexOpening,
  IndexPort,
  IndexStats,
  SearchHit,
  SearchScope,
} from './ports.ts';
export { searchNotes, searchScope } from './search-notes.ts';
