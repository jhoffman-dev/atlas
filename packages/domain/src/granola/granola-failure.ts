/**
 * Why a pull of Granola did not do what was asked, and what the person can
 * do about it. The host says what happened (a kind, and the HTTP status
 * Granola answered); what that means for the person is decided here.
 */

export const GRANOLA_FAILURE_KINDS = [
  /** No API key is held on this Mac for the vault. */
  'no_key',
  'unreachable',
  'timeout',
  /** Granola answered, but not in the shape its API documents. */
  'malformed',
  /** Granola answered a request with an error status; `status` is it. */
  'api_refused',
] as const;

export type GranolaFailureKind = (typeof GRANOLA_FAILURE_KINDS)[number];

export interface GranolaFailure {
  readonly kind: GranolaFailureKind;
  /** The HTTP status Granola answered with, for `api_refused`. */
  readonly status?: number;
  /** What the host said; never a response body, which may hold meeting content. */
  readonly message: string;
  /**
   * True when the request that failed was for a page of a transcript too
   * large to send at once — the host's answer to a 413, which is not itself
   * a failure. A note read part-way is retried, whatever the page's status
   * (but a 401, which stops).
   */
  readonly transcriptPage?: boolean;
}

/** What went wrong in the person's words, and what to do; null when there is nothing to do. */
export interface GranolaProblem {
  readonly problem: string;
  readonly fix: string | null;
}

export function isGranolaFailureKind(value: unknown): value is GranolaFailureKind {
  return (GRANOLA_FAILURE_KINDS as readonly unknown[]).includes(value);
}

const MAKE_A_KEY =
  'Create one in Granola → Settings → Connectors → API keys, and paste it in Settings → Granola.';
const NEXT_PULL = 'Atlas tries again on the next pull.';
const SKIPPED = 'It was skipped; Sync now tries it again.';

/** Granola answered with an error status. */
function refusal(status: number | undefined): GranolaProblem {
  if (status === 401) return { problem: 'Granola refused the API key.', fix: MAKE_A_KEY };
  if (status === 403) {
    return {
      problem: 'Granola does not let this API key read the note.',
      fix: 'Check the key’s scopes in Granola → Settings → Connectors → API keys: Personal notes, and Public notes for notes others share. Then press Sync now.',
    };
  }
  if (status === 404) {
    return {
      problem:
        'Granola no longer has the note, or it is no longer shared with you; it was skipped.',
      fix: null,
    };
  }
  if (status === 413) {
    return {
      problem: 'The meeting’s transcript is too large for Granola to send in one answer.',
      fix: 'Atlas reads it in pages on the next pull.',
    };
  }
  if (status === 408) return { problem: 'Granola did not answer in time.', fix: NEXT_PULL };
  if (status === 429) return { problem: 'Granola asked Atlas to slow down.', fix: NEXT_PULL };
  if (status !== undefined && status >= 500 && status <= 599) {
    return {
      problem: `Granola is having trouble (status ${status}).`,
      fix: 'Try Sync now later.',
    };
  }
  return { problem: `Granola refused the request (${status ?? 'no status'}).`, fix: SKIPPED };
}

/** The person's problem and its fix, for any failure. */
export function explainGranolaFailure(failure: GranolaFailure): GranolaProblem {
  switch (failure.kind) {
    case 'api_refused':
      return refusal(failure.status);
    case 'no_key':
      return { problem: 'No Granola API key is set on this Mac.', fix: MAKE_A_KEY };
    case 'unreachable':
      return {
        problem: `Granola could not be reached: ${failure.message}.`,
        fix: `Check the connection. ${NEXT_PULL}`,
      };
    case 'timeout':
      return {
        problem: 'Granola did not answer in time.',
        fix: `Check the connection. ${NEXT_PULL}`,
      };
    case 'malformed':
      return {
        problem: `Granola answered in a way Atlas does not understand: ${failure.message}.`,
        fix: SKIPPED,
      };
  }
}

/**
 * What a failure means for the pull (ADR-0034's watermark rule):
 *
 * - `stop` when there is no key or Granola refused it (401): every later
 *   request would be refused too.
 * - `retry` only for a failure that may pass by itself — the network, a
 *   timeout, 408, 429, a 5xx, or a page of a transcript — which holds the
 *   watermark so the next pull lists the note again.
 * - `skip` for the rest — 404, 403, any other refusal, an answer Atlas could
 *   not read — which would fail the same way on every pull. It settles the
 *   note (logged, the watermark not held); Sync now's full listing tries it
 *   again, once the key or Granola has changed.
 *
 * A 413 is not a failure: the host reads that transcript in pages. One that
 * reaches here anyway is retried, so the next pull reads it in pages.
 */
export type GranolaFailureEffect = 'stop' | 'skip' | 'retry';

/** A status that may pass by itself: a timeout, too many requests, Granola's own trouble. */
const isTransientStatus = (status: number) =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

/** What Granola's status means for the pull, once 401 has stopped it. */
function statusEffect(status: number | undefined): GranolaFailureEffect {
  if (status === undefined) return 'skip';
  return status === 413 || isTransientStatus(status) ? 'retry' : 'skip';
}

export function granolaFailureEffect(failure: GranolaFailure): GranolaFailureEffect {
  if (failure.kind === 'no_key') return 'stop';
  if (failure.kind === 'api_refused' && failure.status === 401) return 'stop';
  if (failure.transcriptPage === true) return 'retry';
  switch (failure.kind) {
    case 'unreachable':
    case 'timeout':
      return 'retry';
    case 'malformed':
      return 'skip';
    case 'api_refused':
      return statusEffect(failure.status);
  }
}
