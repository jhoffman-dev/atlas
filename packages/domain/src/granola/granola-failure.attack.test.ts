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
 * Adversarial (P28-09, fix commits): a failed transcript page was retried —
 * it held the watermark and the next pull asked again — whatever its status
 * but 401, while explainGranolaFailure told the person the note "was
 * skipped". Round 2 settled it the other way: a page is a request like any
 * other, so a 404, a 400 or an answer DFAI could not read on a page is
 * skipped (it fails the same on every pull), and the person is told so.
 */
describe('explainGranolaFailure for a failed page of a transcript', () => {
  const page = (failure: GranolaFailure): GranolaFailure => ({ ...failure, transcriptPage: true });
  it.each([
    ['a 404', page(refused(404))],
    ['a 400', page(refused(400))],
    ['an answer DFAI could not read', page({ kind: 'malformed', message: 'what the host said' })],
  ])('with %s says it was skipped, as the pull does, not that it is tried again', (_, failure) => {
    expect(granolaFailureEffect(failure)).toBe('skip');
    const { problem, fix } = explainGranolaFailure(failure);
    const said = `${problem} ${fix ?? ''}`;
    expect(said).toMatch(/skipped/);
    expect(said).not.toMatch(/tries again on the next pull/);
  });
});
