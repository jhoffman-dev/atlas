/**
 * Attack on PR #547 (#37): which web addresses in an untrusted answer Ask
 * makes clickable. Fictional hosts only (example.com).
 */

import { describe, expect, it } from 'vitest';
import { answerInline, isWebAddress } from './answer-inline.ts';

describe('isWebAddress, attacked (PR #547)', () => {
  it('refuses an address with a user part, which shows one host and opens another', () => {
    // Opens evil.example.com while reading as larkspur.example.com.
    expect(isWebAddress('https://larkspur.example.com@evil.example.com/payroll')).toBe(false);
    expect(isWebAddress('https://mara:secret@example.com')).toBe(false);
  });

  it('refuses an address whose host is not where it is written, https:///host', () => {
    // `new URL` mends the empty authority, so the host the browser opens is
    // not the one the text shows after `https://`.
    expect(isWebAddress('https:///evil.example.com')).toBe(false);
    expect(isWebAddress('https://\\evil.example.com')).toBe(false);
  });

  it('leaves a markdown link that hides its host behind a user part as the text it was written as', () => {
    expect(
      answerInline('[the payroll portal](https://larkspur.example.com@evil.example.com)'),
    ).toEqual([
      { kind: 'text', text: '[the payroll portal](https://larkspur.example.com@evil.example.com)' },
    ]);
  });
});
