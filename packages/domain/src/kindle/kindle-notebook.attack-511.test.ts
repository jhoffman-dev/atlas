import { describe, expect, it } from 'vitest';
import { readKindleAnnotations } from './kindle-annotations.ts';
import type { KindleRawPage } from './kindle-types.ts';

/*
 * Second verification of PR #511 (after the fix round at b4e81c01): note-only keys against the
 * unicode variants the key claims to read as one. The books are invented.
 */

const page = (html: string): KindleRawPage => ({ status: 200, html, redirectedTo: null });
const noteOnly = (note: string) =>
  page(
    `<div id="kp-notebook-annotations"><div id="IDNOTEONLY01" class="a-row a-spacing-base"><span id="note">${note}</span></div></div>`,
  );

const keysOf = (raw: KindleRawPage) => {
  const reading = readKindleAnnotations(raw, 'B0EXAMPLE1');
  return reading.kind === 'annotations' ? reading.highlights.map((h) => h.key) : [reading.kind];
};

describe('a note-only key across syncs of an unchanged note', () => {
  it('is the same when a zero-width space sits between a letter and its combining accent', () => {
    // "café" composed one day; the next, written e + ZWSP + combining acute. Stripped of the
    // zero-width space and composed, both are "café", so the note is unchanged.
    const composed = keysOf(noteOnly('Tea at the café.'));
    const decomposed = keysOf(noteOnly('Tea at the cafe​́.'));
    expect(composed[0]).toMatch(/^amazon:IDNOTEONLY01:note:/);
    expect(decomposed).toEqual(composed);
  });
});
