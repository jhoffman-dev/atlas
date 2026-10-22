export { KINDLE_MIN_FETCH_GAP_MS, syncKindle } from './sync-kindle.ts';
export type { KindleSyncPorts } from './sync-kindle.ts';
export { isKindleFetchFailureKind, KINDLE_FETCH_FAILURE_KINDS, KindleFetchError } from './ports.ts';
export type {
  KindleDelay,
  KindleFetchFailureKind,
  KindleHighlightSink,
  KindleNotebookSource,
  KindleSession,
} from './ports.ts';
