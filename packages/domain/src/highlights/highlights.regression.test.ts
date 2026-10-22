import { describe, expect, it } from 'vitest';
import type { HighlightAnchor } from './anchor.ts';
import {
  appendHighlights,
  HighlightNotReadBackError,
  withoutHighlight,
  type NewHighlight,
} from './edit-highlights.ts';
import { readHighlights } from './highlight-block.ts';
import { highlightMarker } from './highlight-marker.ts';
import { findQuote } from './reanchor.ts';
import { literatureNoteText } from './literature-note.ts';
import { createVaultPath } from '../vault/vault-path.ts';

/**
 * Verification of the fix round on PR #510 (#503, ADR-0043): each test is one
 * invariant the fixes claim, attacked past the test that came with the fix.
 * Each fails while the gap it names stands.
 */

/** mulberry32: a seeded random source, so every run draws the same ids. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDLE_NOTE = literatureNoteText({
  kind: 'kindle',
  title: 'Emma',
  author: 'Jane Austen',
  file: null,
});
const PDF_NOTE = literatureNoteText({
  kind: 'pdf',
  title: 'The Art of War',
  author: 'Sun Tzu',
  file: createVaultPath('Library/The Art of War.pdf'),
});

const pdf = (exact: string): HighlightAnchor => ({
  kind: 'pdf',
  page: 3,
  quote: { exact, prefix: '', suffix: '' },
  rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.02 }],
});

const appended = (text: string, highlights: readonly NewHighlight[], seed = 1) =>
  appendHighlights({ text, highlights, random: seeded(seed) });

const KNOW = { quote: 'Know the enemy.', anchor: pdf('Know the enemy.') };

const MARKER = highlightMarker({
  style: { mark: 'highlight', color: 'yellow' },
  anchor: pdf('All warfare is based on deception.'),
});

describe('R1: appending never writes a highlight the note hides (verify #510)', () => {
  it.each([
    ['an unclosed <pre> block (CommonMark HTML block 1 runs to the end)', '<pre>\nkept as typed\n'],
    ['an unclosed <script> block', '<script>\nconst draft = 1;\n'],
    ['an unclosed <style> block', '<style>\n.callout { color: red; }\n'],
    [
      'an unclosed Obsidian %% comment, which hides the rest of the note',
      '%%\nA private thought.\n',
    ],
  ])('refuses to append after %s', (_, tail) => {
    const note = `${PDF_NOTE}My notes.\n\n${tail}`;
    expect(() => appended(note, [KNOW])).toThrow(HighlightNotReadBackError);
  });

  it('does not take a fence inside a list item as running to the end of the note', () => {
    // The list item ends at the column-0 quote below it, and its fence with it, so
    // Obsidian shows the highlight. The tracker keeps the fence open for ever: every
    // append is refused and every highlight after the list is invisible to DFAI.
    const note = `${PDF_NOTE}- Step one\n  \`\`\`sh\n  make draft\n`;
    expect(() => appended(note, [KNOW])).not.toThrow();
  });
});

describe('R2: a lazy line in Obsidian stays part of the highlight (verify #510)', () => {
  const block = (lazy: string) =>
    [
      '> All warfare is based on deception.',
      `> ${MARKER}`,
      '>',
      '> The line every summary quotes,',
      lazy,
      '',
      '^k3x9q2',
      '',
    ].join('\n');

  it.each([
    ['a tag at the line start (not a heading: no space after #)', '#strategy and #deception'],
    [
      'strikethrough at the line start (two tildes are no fence)',
      '~~wrong~~ and every general forgets.',
    ],
    ['inline code at the line start (one backtick is no fence)', '`deceive()` is what it calls.'],
    [
      'inline HTML at the line start (cannot interrupt a paragraph)',
      '<b>and</b> every general forgets.',
    ],
    ['an autolink at the line start', '<https://example.org/sun-tzu> has the rest.'],
  ])('keeps the highlight when its comment continues with %s', (_, lazy) => {
    const found = readHighlights(PDF_NOTE + block(lazy));
    expect(found.map((highlight) => highlight.id)).toEqual(['k3x9q2']);
  });
});

describe('R3/A10: a Kindle passage is synced once across export formats (verify #510)', () => {
  it('answers the existing id when the id-less copy had a location range and the id export gives only its start', () => {
    // My Clippings gives "Location 77-79" and no id; the notebook export gives
    // "Location 77" and the annotation id: one passage, one place, the same words.
    const words = 'Emma Woodhouse, handsome, clever, and rich';
    const first = appended(KINDLE_NOTE, [
      {
        quote: words,
        anchor: { kind: 'kindle', location: { start: 77, end: 79 }, annotationId: null },
      },
    ]);
    const again = appended(
      first.text,
      [
        {
          quote: words,
          anchor: { kind: 'kindle', location: { start: 77, end: null }, annotationId: 'A1' },
        },
      ],
      2,
    );
    expect(again.highlights[0]?.added).toBe(false);
  });

  it('keeps two different passages at one location apart when the export gave blank exact words', () => {
    const anchor: HighlightAnchor = {
      kind: 'kindle',
      location: { start: 5, end: null },
      annotationId: null,
      exact: '',
    };
    const { highlights } = appended(KINDLE_NOTE, [
      { quote: 'Emma Woodhouse, handsome, clever, and rich', anchor },
      { quote: 'The real evils of her situation', anchor },
    ]);
    expect(highlights.map((highlight) => highlight.added)).toEqual([true, true]);
  });
});

describe('A11: removing what was added gives the note back (verify #510)', () => {
  it.each([
    ['one blank line', 'My notes.\n\n'],
    ['two blank lines', 'My notes.\n\n\n'],
    ['a blank line of spaces', 'My notes.\n  \n'],
    ['a Windows blank line', 'My notes.\r\n\r\n'],
  ])('gives the note back byte for byte when it ended in %s', (_, body) => {
    const note = PDF_NOTE.replace(/\n/g, body.includes('\r') ? '\r\n' : '\n') + body;
    const { text, highlights } = appended(note, [KNOW]);
    expect(withoutHighlight({ text, id: highlights[0]?.id as string })).toBe(note);
  });
});

describe('A9: re-anchoring picks no copy on noise (verify #510)', () => {
  it('answers no match when the copies differ only by one space of matching surroundings', () => {
    // The original attack's text: neither copy's surroundings are the selector's;
    // the first wins only because a space follows it and the suffix starts with one.
    const text = 'One said: know the enemy. Two said: know the enemy.';
    expect(
      findQuote(text, { exact: 'know the enemy.', prefix: 'Other edition: ', suffix: ' Next' }),
    ).toBeNull();
  });
});
