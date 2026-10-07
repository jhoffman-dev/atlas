/**
 * Adversarial pass on the tag rules (P20-01, P20-05): a rename touches only
 * what it renames, and reading tags stays linear on a long line.
 */
import { describe, expect, it } from 'vitest';
import { findTags } from './tag-grammar.ts';
import { renameTagInProperty } from './note-tags.ts';

describe('renaming a tag in a tags property', () => {
  it('leaves items it does not rename, even two spellings of one tag', () => {
    const renamed = renameTagInProperty(['Idea', 'idea', 'x'], { from: 'x', to: 'y' });
    expect(renamed?.value).toEqual(['Idea', 'idea', 'y']);
  });
});

describe('reading tags in a long line', () => {
  // Pasted logs and minified text reach here as one text run. Linear work is a
  // few milliseconds; the shields' quadratic backtracking takes seconds.
  it.each([
    ['unclosed brackets', '#a ' + '['.repeat(80_000)],
    ['unclosed angle brackets', '#a ' + '<'.repeat(80_000)],
  ])('stays fast with %s', (_label, text) => {
    const started = performance.now();
    expect(findTags(text).map((tag) => tag.name)).toEqual(['a']);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
