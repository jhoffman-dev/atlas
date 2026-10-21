import type { ActivityLevel, ActivityReport } from '../activity/activity-event.ts';
import { STALE_ARRIVAL_MS } from './granola-arrival.ts';
import {
  explainGranolaFailure,
  type GranolaFailure,
  type GranolaFailureContext,
} from './granola-failure.ts';
import type { GranolaUnreadableSummary } from './granola-note-types.ts';
import { SLOW_DOWNS_IN_A_ROW } from './granola-pace.ts';
import type { GranolaPullMode } from './granola-watermark.ts';

/**
 * How a pull of Granola ended:
 *
 * - `pulled`: every listed note was looked at;
 * - `not-synced`: it did not start, because this session has not yet
 *   completed a sync pull of the vault (ADR-0034);
 * - `stopped`: a failure every later request would share (no key, a refused
 *   key) ended it;
 * - `failed`: the notes could not be listed, or Granola kept asking DFAI to
 *   slow down;
 * - `vault-changed`: another vault was opened while it ran.
 */
export type GranolaPullEnd = 'pulled' | 'not-synced' | 'stopped' | 'failed' | 'vault-changed';

/** A note the pull did not write, and why, in words that may be read anywhere. */
export interface GranolaNoteProblem {
  readonly id: string;
  readonly title: string | null;
  /** The note in Granola, when Granola's answer named it. */
  readonly url: string | null;
  readonly problem: string;
}

/** What a pull did, counted. */
export interface GranolaPullCounts {
  readonly written: number;
  readonly held: number;
  /** The mapper said no: only a mapper fix changes that. */
  readonly refused: number;
  /** Granola said no in a way that comes back the same on every pull. */
  readonly skipped: number;
  /** Failed in a way that may pass by itself: tried again on the next pull. */
  readonly failed: number;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** What a pull did, in a few words: "3 new, 12 already in DFAI, 1 refused". */
export function granolaCountsLine({
  written,
  held,
  refused,
  skipped,
  failed,
}: GranolaPullCounts): string {
  return [
    written === 0 ? 'nothing new' : `${written} new`,
    `${held} already in DFAI`,
    ...(refused > 0 ? [`${refused} refused`] : []),
    ...(skipped > 0 ? [`${skipped} skipped`] : []),
    ...(failed > 0 ? [`${failed} to try again`] : []),
  ].join(', ');
}

function levelOf({ refused, skipped, failed }: GranolaPullCounts): ActivityLevel {
  if (failed > 0) return 'error';
  return refused + skipped > 0 ? 'warning' : 'info';
}

/** A failure's problem, what to do about it, and what the pull did, met where it was. */
export function granolaFailureWords(
  failure: GranolaFailure,
  during: GranolaFailureContext = 'note',
): string {
  const { problem, fix } = explainGranolaFailure(failure, during);
  return `${problem} ${fix}`;
}

/** Why a pull gave up after {@link SLOW_DOWNS_IN_A_ROW} notes in a row were each refused with 429. */
export const GRANOLA_KEPT_SLOWING_DOWN = `Granola asked DFAI to slow down for ${SLOW_DOWNS_IN_A_ROW} notes in a row, so DFAI stopped this pull. The next pull tries those notes again.`;

/** The most of a listed id a line shows: an id that is not one may be anything, at any length. */
const SHOWN_ID_LENGTH = 40;

/**
 * Any character outside letters, marks, numbers, punctuation, symbols and the
 * plain space (U+0020), and any default-ignorable one (which shows nothing,
 * though some are marks or letters): controls, other spaces and line breaks,
 * format characters (bidi marks, zero-width ones, Unicode tags), lone
 * surrogates, private use and unassigned code points.
 */
const NOT_SHOWN = /[^\p{L}\p{M}\p{N}\p{P}\p{S} ]|\p{Default_Ignorable_Code_Point}/gu;

/**
 * A listed id as a line may show it: every character not shown as itself
 * (see {@link NOT_SHOWN}) made a space, runs of spaces collapsed to one, and
 * the result cut to {@link SHOWN_ID_LENGTH} code points, never through a
 * surrogate pair.
 */
function shownId(id: string | null): string {
  if (id === null) return 'no id';
  const printable = id.replace(NOT_SHOWN, ' ').replace(/ {2,}/g, ' ');
  const characters = Array.from(printable);
  return characters.length > SHOWN_ID_LENGTH
    ? `${characters.slice(0, SHOWN_ID_LENGTH).join('')}…`
    : printable;
}

/** A listed note the pull left out, as a skipped note: its id, cut short, and why. */
export function unreadableSummaryProblem({
  id,
  reason,
}: GranolaUnreadableSummary): GranolaNoteProblem {
  return {
    id: shownId(id),
    title: null,
    url: null,
    problem: `Granola listed a note DFAI cannot read (${reason}); it was left out of this pull.`,
  };
}

/**
 * A pull on the timer that found nothing to write or report, beyond skips
 * Activity has already been told of: a line every 15 minutes would bury the
 * rest.
 */
const isQuietTick = (
  mode: GranolaPullMode,
  ended: GranolaPullEnd,
  counts: GranolaPullCounts,
  skippedBefore: number,
) =>
  mode === 'periodic' &&
  ended === 'pulled' &&
  counts.written + counts.refused + (counts.skipped - skippedBefore) + counts.failed === 0;

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const meetingLine = (level: ActivityLevel, message: string): ActivityReport => ({
  level,
  kind: 'meeting',
  message: `Granola: ${message}`,
  subject: null,
});

/**
 * The one line a pull gets in Activity, with its counts; null for a pull
 * that did not start because the vault has not been synced yet, which is
 * waiting, not failing, and for a timed pull that found nothing new but
 * skips already said.
 */
export function granolaPullReport({
  mode,
  ended,
  counts,
  problem,
  skippedBefore = 0,
}: {
  readonly mode: GranolaPullMode;
  readonly ended: GranolaPullEnd;
  readonly counts: GranolaPullCounts;
  /** Why a pull `stopped` or `failed`, in the person's words. */
  readonly problem: string | null;
  /** Of the skipped notes, those an earlier pull this session already said in Activity. */
  readonly skippedBefore?: number;
}): ActivityReport | null {
  if (isQuietTick(mode, ended, counts, skippedBefore)) return null;
  const before = counts.written > 0 ? ` ${counts.written} new before it did.` : '';
  switch (ended) {
    case 'not-synced':
      return null;
    case 'pulled':
      return meetingLine(levelOf(counts), `${granolaCountsLine(counts)}.`);
    case 'vault-changed':
      return meetingLine(
        'warning',
        `the pull stopped when another vault was opened.${before} The next pull in this vault goes on.`,
      );
    case 'stopped':
    case 'failed': {
      const why = problem === null ? '' : ` ${capitalized(sentence(problem))}`;
      return meetingLine('error', `the pull ${ended}.${why}${before}`);
    }
  }
}

const named = ({ id, title }: GranolaNoteProblem) => `“${title ?? id}”`;
const openIt = ({ url }: GranolaNoteProblem) => (url === null ? '' : ` Open it in Granola: ${url}`);

/** A line for one note the pull did not write: why, and where to open it, never what it says. */
export function granolaNoteReport(
  outcome: 'refused' | 'skipped' | 'failed',
  note: GranolaNoteProblem,
): ActivityReport {
  const why = sentence(note.problem);
  switch (outcome) {
    case 'refused':
      return meetingLine(
        'warning',
        `${named(note)} was not written: ${why} Sync now tries it again.${openIt(note)}`,
      );
    case 'skipped':
      return meetingLine('warning', `${named(note)}: ${why}${openIt(note)}`);
    case 'failed':
      return meetingLine(
        'error',
        `${named(note)} could not be read; the next pull tries it again. ${why}`,
      );
  }
}

/**
 * A pull from the watermark found meetings that the webhook should have
 * brought long since: Granola may have turned the webhook off after four
 * days of failed deliveries, and does not send again what it missed.
 */
export function granolaLateArrivalReport(count: number): ActivityReport {
  const hours = STALE_ARRIVAL_MS / (60 * 60_000);
  return meetingLine(
    'warning',
    `${plural(count, 'meeting')} came by the pull more than ${hours} hours after Granola had ${count === 1 ? 'it' : 'them'}: the webhook may be off. Check it in Granola → Settings → Connectors → Webhooks, and the workflow in n8n.`,
  );
}

/**
 * A pull that waited for the index to catch up with what sync brought in,
 * and gave up: it did not start, so nothing was written. The next sync asks
 * the index again, and a pull follows it.
 */
export function granolaIndexWaitReport(): ActivityReport {
  return meetingLine(
    'warning',
    'the pull did not start: waiting for the index timed out. The next sync, or opening the vault again, tries again.',
  );
}
