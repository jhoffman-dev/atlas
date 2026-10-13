import { describe, expect, it } from 'vitest';
import {
  explainGranolaFailure,
  granolaFailureEffect,
  type GranolaFailure,
} from './granola-failure.ts';

/*
 * Adversarial (P28-09): a 403 is not a transport failure. ADR-0034 holds the
 * watermark only for transport failures ("network, 5xx, 429 after its
 * retries, a failed transcript page"), and lets deterministic outcomes (a
 * refusal, a 404) settle. A 403 is deterministic: the key lacks a scope, as
 * explainGranolaFailure itself says, so it is refused on every pull until the
 * key changes. As `retry` it holds the watermark at that note's updated_at
 * for good: every startup and 15-minute pull lists everything since then and
 * asks for the note again, forever.
 */

const refused = (status: number): GranolaFailure => ({
  kind: 'api_refused',
  status,
  message: 'what the host said',
});

describe('granolaFailureEffect, against ADR-0034’s watermark rule', () => {
  it('does not hold the watermark for a note the key’s scopes do not cover (403)', () => {
    expect(granolaFailureEffect(refused(403))).not.toBe('retry');
  });
});

/*
 * Adversarial (P28-09, fix commits): a failed transcript page is retried —
 * it holds the watermark and the next pull asks again — whatever its status
 * but 401. explainGranolaFailure ignores `transcriptPage` and tells the
 * person the note "was skipped" (and for a 404, that there is nothing to
 * do), the opposite of what the pull does with it.
 */
describe('explainGranolaFailure for a failed page of a transcript', () => {
  const page = (failure: GranolaFailure): GranolaFailure => ({ ...failure, transcriptPage: true });
  it.each([
    ['a 404', page(refused(404))],
    ['a 400', page(refused(400))],
    ['an answer Atlas could not read', page({ kind: 'malformed', message: 'what the host said' })],
  ])('with %s says it is tried again, as the pull does, not that it was skipped', (_, failure) => {
    expect(granolaFailureEffect(failure)).toBe('retry');
    const { problem, fix } = explainGranolaFailure(failure);
    expect(`${problem} ${fix ?? ''}`).not.toMatch(/skipped/);
  });
});
