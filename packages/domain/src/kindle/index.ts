export { readKindleLibrary, KINDLE_ASIN } from './kindle-library.ts';
export { readKindleAnnotations } from './kindle-annotations.ts';
export {
  findKindleKeyClash,
  hashOf,
  kindleHighlightKey,
  kindleNoteKey,
  newKindleHighlights,
} from './kindle-highlight-key.ts';
export {
  holdsKindleAutoSync,
  KINDLE_AUTO_SYNC_HOLD_MS,
  kindleAutoSyncHeldUntil,
  mayAutoSyncKindle,
} from './kindle-backoff.ts';
export {
  KINDLE_MAX_PAGES_PER_BOOK,
  KINDLE_NOTEBOOK_URL,
  kindleAnnotationsUrl,
  kindleLibraryUrl,
} from './kindle-notebook-url.ts';
export {
  describeKindleSync,
  KINDLE_NOT_CONNECTED_MESSAGE,
  KINDLE_RATE_LIMITED_MESSAGE,
  KINDLE_ROBOT_CHECK_MESSAGE,
  KINDLE_SIGN_IN_MESSAGE,
  KINDLE_UNRECOGNISED_MESSAGE,
} from './kindle-sync-report.ts';
export type {
  KindleBookOutcome,
  KindleStopReason,
  KindleSyncProgress,
  KindleSyncReport,
  KindleSyncStop,
} from './kindle-sync-report.ts';
export { KINDLE_HIGHLIGHT_COLOURS } from './kindle-types.ts';
export type {
  KindleAnnotationsReading,
  KindleBook,
  KindleHighlight,
  KindleHighlightColour,
  KindleHighlightKey,
  KindleHighlightStyle,
  KindleLibraryReading,
  KindlePageCursor,
  KindlePageProblem,
  KindleRawPage,
} from './kindle-types.ts';
export { kindleLiteratureNote, kindleNoteMatch, kindleNoteOf } from './kindle-note-match.ts';
export type { KindleNoteMatch } from './kindle-note-match.ts';
export {
  KindleHighlightUnplaceableError,
  KindlePassageGoneError,
  recordedKindleKeys,
  withKindleHighlights,
} from './kindle-note-writes.ts';
export {
  KINDLE_AUTO_SYNC_INTERVAL_MS,
  KINDLE_AUTO_SYNC_MIN_GAP_MS,
  kindleAutoSyncSkip,
  kindleRecordAfterFailure,
  kindleRecordAfterSync,
  NO_KINDLE_SYNC_RECORD,
} from './kindle-auto-sync.ts';
export type { KindleAutoSyncSkip, KindleLastSync, KindleSyncRecord } from './kindle-auto-sync.ts';
