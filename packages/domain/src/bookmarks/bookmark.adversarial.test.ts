import { describe, expect, it } from 'vitest';
import { plainText } from '../markdown/plain-text.ts';
import { noteSummary } from './bookmark-card.ts';

/**
 * Adversarial probes of Phase 22's domain: the words a bookmark card shows,
 * and the comment-hiding `plainText` took on for the marker.
 */

const EMPTY_DOC = { type: 'doc', content: [] } as const;

describe('a bookmark card’s summary', () => {
  // A board card, a list row and a feed card show a `summary` through
  // `plainText`; a bookmark card of the same note should read the same.
  it('shows a described note’s words, not its markdown', () => {
    const summary = noteSummary({
      properties: { description: 'Uses `pnpm` and **care**, see [the guide](https://x.io).' },
      doc: EMPTY_DOC,
    });
    expect(summary).toBe('Uses pnpm and care, see the guide.');
  });
});

describe('plainText hiding a comment', () => {
  it('keeps the words between a comment opener and closer written as code', () => {
    expect(plainText('Type `<!--` to open a comment and `-->` to close it.')).toBe(
      'Type <!-- to open a comment and --> to close it.',
    );
  });
});
