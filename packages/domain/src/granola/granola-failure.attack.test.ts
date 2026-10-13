import { describe, expect, it } from 'vitest';
import { granolaFailureEffect, type GranolaFailure } from './granola-failure.ts';

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
