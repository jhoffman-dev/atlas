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
  // Pasted logs and minified text reach here as one text run. Timed, coarsely,
  // because the shields' backtracking happens inside one regex execution, which
  // no count taken from outside sees (testing/counted-work.ts). At 320,000
  // characters linear reading takes milliseconds and quadratic backtracking
  // about a minute, so ten seconds is a hundred times either side (#385).
  it.each([
    ['unclosed brackets', '#a ' + '['.repeat(320_000)],
    ['unclosed angle brackets', '#a ' + '<'.repeat(320_000)],
  ])('stays linear with %s', { timeout: 120_000 }, (_label, text) => {
    const started = performance.now();
    expect(findTags(text).map((tag) => tag.name)).toEqual(['a']);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
