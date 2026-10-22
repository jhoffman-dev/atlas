import { describe, expect, it } from 'vitest';
import type { HighlightAnchor, HighlightStyle } from './anchor.ts';
import { HIGHLIGHT_COLORS } from './anchor.ts';
import {
  appendHighlights,
  highlightNamed,
  withHighlightComment,
  withoutHighlight,
  type NewHighlight,
} from './edit-highlights.ts';
import { readHighlights, type HighlightBlock } from './highlight-block.ts';
import { commentLines, plainQuote, quoteLines } from './highlight-text.ts';

/**
 * Property (#503): whatever a literature note holds around its highlights, and
 * however the person edited their quotes and comments in Obsidian, every
 * write changes only the highlight it is about. The others read back the
 * same and keep their bytes; the words between them keep theirs; a comment
 * written back as it reads is the same bytes; ids are Obsidian's six
 * characters, drawn from the seeded source and never repeated.
 */

/** mulberry32: a seeded random source, so every run draws the same notes. */
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

const random = seeded(20261021);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const count = (max: number) => Math.floor(random() * (max + 1));

const WORDS = [
  'warfare',
  'deception',
  '*bold*',
  '#tag',
  '==mark==',
  '%%hide%%',
  '[[Moby Dick]]',
  '<b>',
  '-->',
  '<!--',
  'a|b',
  '`code`',
  '^abc123',
  '\\',
  '$x$',
  '&amp;',
  'é',
  '—',
  '1.',
  '-',
  '>',
];

const words = (max: number) =>
  Array.from({ length: 1 + count(max) }, () => pick(WORDS)).join(pick([' ', '  ', '\n', ' \n ']));

const ANCHORS: (() => HighlightAnchor)[] = [
  () => ({
    kind: 'pdf',
    page: 1 + count(400),
    quote: { exact: words(6), prefix: words(3), suffix: words(3) },
    rects: Array.from({ length: count(3) }, () => ({
      x: random() * 0.5,
      y: random() * 0.5,
      width: 0.1 + random() * 0.4,
      height: 0.01 + random() * 0.1,
    })),
  }),
  () => ({
    kind: 'pdf',
    page: 1 + count(9),
    quote: null,
    rects: [{ x: 0, y: random() * 0.5, width: 1, height: 0.25 }],
  }),
  () => ({
    kind: 'epub',
    cfi: `epubcfi(/6/${2 * (1 + count(40))}!/4/2/1:${count(300)})`,
    quote: { exact: words(6), prefix: '', suffix: words(2) },
  }),
  () => ({
    kind: 'kindle',
    location: { start: 1 + count(9000), end: random() < 0.5 ? null : 9001 + count(10) },
    annotationId: random() < 0.5 ? null : `AMZ-${count(1e6)}`,
  }),
];

const style = (): HighlightStyle => ({
  mark: pick(['highlight', 'underline'] as const),
  color: pick(HIGHLIGHT_COLORS),
});

const newHighlight = (): NewHighlight => ({
  quote: words(12),
  anchor: pick(ANCHORS)(),
  style: style(),
  ...(random() < 0.6 && { comment: words(8).replace(/^>|\n>/g, ' ') }),
});

/** What a note holds around highlights: prose, a plain quote, a fence with a look-alike, a list. */
const FILLER = [
  // Prose never opens with `<!--`: a line that does is an HTML comment block, which hides the rest if unclosed.
  () => `Prose: ${words(10).replace(/\n/g, ' ')}\n`,
  () => '> A plain quote, no marker.\n',
  () =>
    '```\n> Not a highlight.\n> <!-- atlas:highlight {"v":1,"kind":"kindle","location":3} -->\n\n^fake01\n```\n',
  () => '- a list item ^li0001\n',
  () => '## A heading\n',
];

function literatureNote(): string {
  const body = Array.from({ length: count(4) }, () => pick(FILLER)()).join('\n');
  return `---\ntype: literature\nkind: pdf\ntitle: "Generated"\n---\n${body}`;
}

/** Edits a person makes in Obsidian: tidy a quote line, add a line to a comment, words between blocks. */
function editedByHand(text: string): string {
  const blocks = readHighlights(text);
  let edited = text;
  for (const block of [...blocks].reverse()) {
    const choice = count(3);
    if (choice === 0) edited = splice(edited, block.start, block.start + 1, '>  ');
    if (choice === 1)
      edited = splice(edited, block.quoteEnd, block.quoteEnd, '>\n> Added in Obsidian.\n');
    if (choice === 2) edited = splice(edited, block.end, block.end, '\nWritten between.\n');
  }
  return edited;
}

const splice = (text: string, start: number, end: number, insert: string) =>
  text.slice(0, start) + insert + text.slice(end);

const model = ({ id, quote, comment, style: drawn, anchor }: HighlightBlock) => ({
  id,
  quote,
  comment,
  style: drawn,
  anchor,
});

const bytesOf = (text: string, block: HighlightBlock) => text.slice(block.start, block.end);

function expectOthersKept(before: string, after: string, except: string | null) {
  const kept = readHighlights(before).filter((block) => block.id !== except);
  const now = new Map(readHighlights(after).map((block) => [block.id, block]));
  for (const block of kept) {
    const read = now.get(block.id);
    expect(read && model(read)).toEqual(model(block));
    expect(read && bytesOf(after, read)).toBe(bytesOf(before, block));
  }
}

const RUNS = 300;

describe('literature notes under any edits', () => {
  it('reads back every highlight appended, with fresh ids, and writes only after the last byte', () => {
    for (let run = 0; run < RUNS; run += 1) {
      const before = literatureNote();
      const added = Array.from({ length: 1 + count(4) }, newHighlight);
      const { text, highlights } = appendHighlights({ text: before, highlights: added, random });
      expect(text.startsWith(before)).toBe(true);
      const fresh = highlights
        .filter((highlight) => highlight.added)
        .map((highlight) => highlight.id);
      expect(new Set(fresh).size).toBe(fresh.length);
      for (const id of fresh) expect(id).toMatch(/^[a-z0-9]{6}$/);
      expect(fresh).not.toContain('li0001');
      for (const [index, highlight] of added.entries()) {
        const answered = highlights[index];
        if (answered?.added !== true) continue;
        const block = highlightNamed(text, answered.id);
        expect(plainQuote(block.quote)).toBe(
          quoteLines(highlight.quote).map(plainQuote).join('\n\n'),
        );
        // A Kindle anchor keeps the export's words (R3).
        const written =
          highlight.anchor.kind === 'kindle'
            ? { ...highlight.anchor, exact: highlight.quote }
            : highlight.anchor;
        expect(block.anchor).toEqual(written);
        expect(block.comment).toBe(commentLines(highlight.comment ?? '').join('\n'));
        expect(block.style).toEqual(highlight.style);
      }
      expect(readHighlights(before)).toEqual([]);
    }
  });

  it('changes only the comment it is given, keeping hand edits everywhere', () => {
    for (let run = 0; run < RUNS; run += 1) {
      const { text: written } = appendHighlights({
        text: literatureNote(),
        highlights: Array.from({ length: 1 + count(4) }, newHighlight),
        random,
      });
      const text = editedByHand(written);
      const target = pick(readHighlights(text));
      const comment = random() < 0.2 ? '' : words(6).replace(/^>|\n>/g, ' ');
      const changed = withHighlightComment({ text, id: target.id, comment });
      expect(highlightNamed(changed, target.id).comment).toBe(commentLines(comment).join('\n'));
      expect(highlightNamed(changed, target.id).quote).toBe(target.quote);
      expect(changed.slice(0, target.markerEnd)).toBe(text.slice(0, target.markerEnd));
      expect(changed.endsWith(text.slice(target.quoteEnd))).toBe(true);
      expectOthersKept(text, changed, target.id);
    }
  });

  it('writes back the same bytes for every comment as it reads', () => {
    for (let run = 0; run < RUNS; run += 1) {
      const { text: written } = appendHighlights({
        text: literatureNote(),
        highlights: Array.from({ length: 1 + count(4) }, newHighlight),
        random,
      });
      const text = editedByHand(written);
      for (const block of readHighlights(text)) {
        expect(withHighlightComment({ text, id: block.id, comment: block.comment })).toBe(text);
      }
    }
  });

  it('removes only the highlight it is given, and removing all it added gives the note back', () => {
    for (let run = 0; run < RUNS; run += 1) {
      const before = `${literatureNote().trimEnd()}\n`;
      const { text: written, highlights } = appendHighlights({
        text: before,
        highlights: Array.from({ length: 1 + count(4) }, newHighlight),
        random,
      });
      const text = editedByHand(written);
      const target = pick(readHighlights(text));
      const removed = withoutHighlight({ text, id: target.id });
      expect(readHighlights(removed).map((block) => block.id)).not.toContain(target.id);
      expectOthersKept(text, removed, target.id);
      let emptied = written;
      for (const { id } of [...highlights].reverse()) {
        if (readHighlights(emptied).some((block) => block.id === id))
          emptied = withoutHighlight({ text: emptied, id });
      }
      expect(emptied).toBe(before);
    }
  });
});
