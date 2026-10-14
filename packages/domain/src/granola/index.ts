export { nextWatermark, sinceOf, WATERMARK_OVERLAP_MS } from './granola-watermark.ts';
export type {
  GranolaNoteOutcome,
  GranolaNoteResult,
  GranolaPullMode,
} from './granola-watermark.ts';
export {
  backoff,
  paceOf,
  REQUESTS_PER_SECOND,
  RETRIES,
  SLOW_DOWNS_IN_A_ROW,
} from './granola-pace.ts';
export {
  explainGranolaFailure,
  GRANOLA_FAILURE_KINDS,
  granolaFailureEffect,
  isGranolaFailureKind,
} from './granola-failure.ts';
export type {
  GranolaFailure,
  GranolaFailureContext,
  GranolaFailureEffect,
  GranolaFailureKind,
  GranolaProblem,
} from './granola-failure.ts';
export { isStaleArrival, STALE_ARRIVAL_MS } from './granola-arrival.ts';
export {
  DEFAULT_GRANOLA_TIME_ZONE,
  GRANOLA_GROUP_ADDRESSES_KEY,
  GRANOLA_PERIODIC_KEY,
  GRANOLA_SELF_EMAILS_KEY,
  GRANOLA_TIME_ZONE_KEY,
  GRANOLA_WEBHOOK_KEY,
  parseGranolaSettings,
} from './granola-settings.ts';
export type { GranolaSettings } from './granola-settings.ts';
export type {
  GranolaNote,
  GranolaNoteSummary,
  GranolaUnreadableSummary,
} from './granola-note-types.ts';
export {
  TRANSCRIPT_LIMIT,
  TRANSCRIPT_TOO_LONG,
  transcriptCharacters,
  transcriptOverLimit,
} from './granola-transcript.ts';
export {
  GRANOLA_KEPT_SLOWING_DOWN,
  granolaCountsLine,
  granolaFailureWords,
  granolaLateArrivalReport,
  granolaNoteReport,
  granolaPullReport,
  unreadableSummaryProblem,
} from './granola-pull-report.ts';
export type {
  GranolaNoteProblem,
  GranolaPullCounts,
  GranolaPullEnd,
} from './granola-pull-report.ts';
