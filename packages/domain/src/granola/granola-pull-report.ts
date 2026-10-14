import type { ActivityLevel, ActivityReport } from '../activity/activity-event.ts';
import { STALE_ARRIVAL_MS } from './granola-arrival.ts';
import { explainGranolaFailure, type GranolaFailure } from './granola-failure.ts';

/**
 * How a pull of Granola ended:
 *
 * - `pulled`: every listed note was looked at;
 * - `not-synced`: it did not start, because this session has not yet
 *   completed a sync pull of the vault (ADR-0034);
 * - `stopped`: a failure every later request would share (no key, a refused
 *   key) ended it;
 * - `failed`: the notes could not be listed;
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

function countsLine({ written, held, refused, skipped, failed }: GranolaPullCounts): string {
  return [
    written === 0 ? 'nothing new' : `${written} new`,
    `${held} already in Atlas`,
    ...(refused > 0 ? [`${refused} refused`] : []),
    ...(skipped > 0 ? [`${skipped} skipped`] : []),
    ...(failed > 0 ? [`${failed} to try again`] : []),
  ].join(', ');
}

function levelOf({ refused, skipped, failed }: GranolaPullCounts): ActivityLevel {
  if (failed > 0) return 'error';
  return refused + skipped > 0 ? 'warning' : 'info';
}

/** A failure's problem, what to do about it, and what the pull did. */
export function granolaFailureWords(failure: GranolaFailure): string {
  const { problem, fix } = explainGranolaFailure(failure);
  return `${problem} ${fix}`;
}

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
 * waiting, not failing.
 */
export function granolaPullReport({
  ended,
  counts,
  problem,
}: {
  readonly ended: GranolaPullEnd;
  readonly counts: GranolaPullCounts;
  /** Why a pull `stopped` or `failed`, in the person's words. */
  readonly problem: string | null;
}): ActivityReport | null {
  const before = counts.written > 0 ? ` ${counts.written} new before it did.` : '';
  switch (ended) {
    case 'not-synced':
      return null;
    case 'pulled':
      return meetingLine(levelOf(counts), `${countsLine(counts)}.`);
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
