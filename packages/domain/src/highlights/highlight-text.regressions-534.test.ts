import { describe, expect, it } from 'vitest';
import type { HighlightBlock } from './highlight-block.ts';
import { commentLines } from './highlight-text.ts';
import { highlightView } from './highlight-view.ts';

/*
 * Regressions found in PR #534 (verification pass on 510eced0): the field
 * showed a comment with its write escapes taken off, so a person's own `%\%`
 * came back as `%%` and the next write could hide what it had not. The field
 * now shows the comment as the file holds it (`highlightView`), and writing it
 * escapes only a new unbalanced `%%` (`commentLines`). What the person typed,
 * shown, then written again after any edit elsewhere in it, must keep what
 * Obsidian reads as hidden the same.
 */

const written = (typed: string): string => commentLines(typed).join('\n');
const shown = (onDisk: string): string =>
  highlightView({
    id: 'k3x9q2',
    quote: 'The last lamp.',
    comment: onDisk,
    style: { mark: 'underline', color: 'green' },
    anchor: { kind: 'kindle', location: { start: 41, end: 41 }, annotationId: null },
    start: 0,
    markerEnd: 0,
    quoteEnd: 0,
    end: 0,
  } satisfies HighlightBlock).comment;

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
  it('is shown as the file holds it, escapes and all', () => {
    expect(shown(written('a %% b %\\% c'))).toBe('a %\\% b %\\% c');
  });

  it('a new unbalanced %% typed in the field is still escaped on write', () => {
    const onDisk = written('a %\\% b');
    expect(written(`${shown(onDisk)} and 50%% more`)).toBe('a %\\% b and 50%\\% more');
  });

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
      // Shown → written → shown is stable: the same bytes, so the same `%%` hidden.
      if (written(shown(onDisk)) !== onDisk || shown(written(shown(onDisk))) !== shown(onDisk)) {
        broken.push(typed);
      }
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });
});
