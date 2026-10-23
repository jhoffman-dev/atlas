import { describe, expect, it } from 'vitest';
import { commentLines, undoCommentEscapes } from './highlight-text.ts';

/*
 * Verification pass on PR #534 (head 510eced0): the field shows a comment with
 * its write escapes taken off (`undoCommentEscapes`), and writing it escapes it
 * again (`commentLines`). What the person typed, shown, then written again after
 * any edit elsewhere in it, must keep what Obsidian reads as hidden the same.
 */

const written = (typed: string): string => commentLines(typed).join('\n');
const shown = (onDisk: string): string => undoCommentEscapes(onDisk);

/** A tiny seeded generator (mulberry32), so a failure names its seed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('a comment typed with a literal %\\% in it', () => {
  it('reads the same once shown and written again: "a %% b %\\% c"', () => {
    const onDisk = written('a %% b %\\% c');
    // The person adds a word at the end: the field's words are written again.
    const rewritten = written(`${shown(onDisk)} more`);
    expect(rewritten).toBe(`${onDisk} more`);
  });

  it('round-trips shown → written for any mix of %, \\ and words (seeded)', () => {
    const alphabet = ['%', '%', '\\', 'a', ' ', '`'];
    const random = rng(534);
    const broken: string[] = [];
    for (let run = 0; run < 2000; run += 1) {
      const length = 1 + Math.floor(random() * 10);
      let typed = '';
      for (let at = 0; at < length; at += 1) {
        typed += alphabet[Math.floor(random() * alphabet.length)];
      }
      typed = `x${typed}x`;
      const onDisk = written(typed);
      if (written(shown(onDisk)) !== onDisk) broken.push(typed);
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });
});
