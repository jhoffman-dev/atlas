/**
 * Why a pull of Granola did not do what was asked, and what the person can
 * do about it. The host says what happened (a kind, and the HTTP status
 * Granola answered); what that means for the person is decided here.
 */

export const GRANOLA_FAILURE_KINDS = [
  /** No API key is held on this Mac for the vault. */
  'no_key',
  /** The host would not send the request: no vault open, or not the one named. */
  'invalid',
  /** The Keychain would not give the host the key. */
  'keychain',
  'unreachable',
  'timeout',
  /** Granola's answer is larger than the host will read. */
  'too_large',
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
   * a failure. A page is judged by its status like any other request, but
   * for a 413 of its own: paging was the remedy, so it is skipped.
   */
  readonly transcriptPage?: boolean;
}

/**
 * What went wrong in the person's words, and what to do. `fix` always ends
 * with what the pull did about it (skipped, tried again, stopped), taken from
 * {@link granolaFailureEffect} so the two cannot disagree.
 */
export interface GranolaProblem {
  readonly problem: string;
  readonly fix: string;
}

export function isGranolaFailureKind(value: unknown): value is GranolaFailureKind {
  return (GRANOLA_FAILURE_KINDS as readonly unknown[]).includes(value);
}

/**
 * What a failure means for the pull (ADR-0034's watermark rule):
 *
 * - `stop` when there is no key, the Keychain will not give it, Granola
 *   refused it (401), or the host will not send for this vault: every later
 *   request would fail the same way.
 * - `retry` only for a failure that may pass by itself — the network, a
 *   timeout, 408, 429, a 5xx, or a 413 for a whole transcript (the next pull
 *   reads it in pages) — which holds the watermark so the next pull lists
 *   the note again.
 * - `skip` for the rest — 404, 403, any other refusal, an answer Atlas could
 *   not read or would not read for its size, a 413 for a page — which would fail the same way on every
 *   pull. It settles the note (logged, the watermark not held); Sync now's
 *   full listing tries it again, once the key or Granola has changed.
 *
 * A page of a transcript is a request like any other: its status decides.
 * A kind the host sends that this rule does not know is skipped: holding the
 * watermark for it could hold it for good, and stopping would stop every pull.
 */
export type GranolaFailureEffect = 'stop' | 'skip' | 'retry';

/** A status that may pass by itself: a timeout, too many requests, Granola's own trouble. */
const isTransientStatus = (status: number) =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

/** What Granola's status means for the pull, once 401 has stopped it. */
function statusEffect(status: number | undefined, transcriptPage: boolean): GranolaFailureEffect {
  if (status === undefined) return 'skip';
  if (status === 413) return transcriptPage ? 'skip' : 'retry';
  return isTransientStatus(status) ? 'retry' : 'skip';
}

export function granolaFailureEffect(failure: GranolaFailure): GranolaFailureEffect {
  switch (failure.kind) {
    case 'no_key':
    case 'invalid':
    case 'keychain':
      return 'stop';
    case 'unreachable':
    case 'timeout':
      return 'retry';
    case 'malformed':
    case 'too_large':
      return 'skip';
    case 'api_refused':
      if (failure.status === 401) return 'stop';
      return statusEffect(failure.status, failure.transcriptPage === true);
    default:
      return 'skip';
  }
}

/** What the pull did, in the person's words: one clause per effect. */
const OUTCOME: Readonly<Record<GranolaFailureEffect, string>> = {
  stop: 'Atlas stops pulling until it has a key Granola accepts.',
  retry: 'Atlas tries again on the next pull.',
  skip: 'It was skipped; Sync now tries it again.',
};

/** What a pull the host would not send for did: the next one asks again. */
const STOPPED_THIS_PULL = 'Atlas stops pulling; the next pull asks again.';

/** What went wrong, and what the person can do about it (null for nothing). */
interface Cause {
  readonly problem: string;
  readonly remedy: string | null;
}

const MAKE_A_KEY =
  'Create one in Granola → Settings → Connectors → API keys, and paste it in Settings → Granola.';

/** Granola answered with an error status. */
function refusal(status: number | undefined, transcriptPage: boolean): Cause {
  if (status === 401) return { problem: 'Granola refused the API key.', remedy: MAKE_A_KEY };
  if (status === 403) {
    return {
      problem: 'Granola does not let this API key read the note.',
      remedy:
        'Check the key’s scopes in Granola → Settings → Connectors → API keys: Personal notes, and Public notes for notes others share.',
    };
  }
  if (status === 404) {
    return {
      problem: 'Granola no longer has the note, or it is no longer shared with you.',
      remedy: null,
    };
  }
  if (status === 413 && transcriptPage) {
    return {
      problem: 'A page of the meeting’s transcript is still too large for Granola to send.',
      remedy: null,
    };
  }
  if (status === 413) {
    return {
      problem: 'The meeting’s transcript is too large for Granola to send in one answer.',
      remedy: 'Atlas reads a transcript that large in pages.',
    };
  }
  if (status === 408) return { problem: 'Granola did not answer in time.', remedy: null };
  if (status === 429) return { problem: 'Granola asked Atlas to slow down.', remedy: null };
  if (status !== undefined && status >= 500 && status <= 599) {
    return {
      problem: `Granola is having trouble (status ${status}).`,
      remedy: 'Try Sync now later.',
    };
  }
  return { problem: `Granola refused the request (${status ?? 'no status'}).`, remedy: null };
}

/** What went wrong, for any failure the host can report. */
function causeOf(failure: GranolaFailure): Cause {
  switch (failure.kind) {
    case 'api_refused':
      return refusal(failure.status, failure.transcriptPage === true);
    case 'no_key':
      return { problem: 'No Granola API key is set on this Mac.', remedy: MAKE_A_KEY };
    case 'invalid':
      return { problem: `Atlas could not ask Granola: ${failure.message}.`, remedy: null };
    case 'keychain':
      return {
        problem: `The Keychain did not give Atlas the Granola API key: ${failure.message}.`,
        remedy: 'Unlock the Keychain, or paste the key again in Settings → Granola.',
      };
    case 'too_large':
      return { problem: 'Granola answered with more than Atlas will read.', remedy: null };
    case 'unreachable':
      return {
        problem: `Granola could not be reached: ${failure.message}.`,
        remedy: 'Check the connection.',
      };
    case 'timeout':
      return { problem: 'Granola did not answer in time.', remedy: 'Check the connection.' };
    case 'malformed':
      return {
        problem: `Granola answered in a way Atlas does not understand: ${failure.message}.`,
        remedy: null,
      };
    default:
      return {
        problem: `Granola could not be read: ${(failure as GranolaFailure).message}.`,
        remedy: null,
      };
  }
}

/** The person's problem and its fix, for any failure, ending with what the pull did about it. */
export function explainGranolaFailure(failure: GranolaFailure): GranolaProblem {
  const { problem, remedy } = causeOf(failure);
  const outcome =
    failure.kind === 'invalid' ? STOPPED_THIS_PULL : OUTCOME[granolaFailureEffect(failure)];
  return { problem, fix: remedy === null ? outcome : `${remedy} ${outcome}` };
}
