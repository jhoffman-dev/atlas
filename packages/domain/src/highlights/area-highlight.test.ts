import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '../testing/line-note-blocks.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { appendHighlights, heldHighlight, type NewHighlight } from './edit-highlights.ts';
import { readHighlights } from './highlight-block.ts';
import { literatureFileOf, literatureNoteText, UnsafeSourceFileError } from './literature-note.ts';

/*
 * An area of a scanned page (#504): no words, a box, and a picture of the
 * box embedded as the quote so a transclusion of it shows something.
 */

const SOURCE = literatureNoteText({
  kind: 'pdf',
  title: 'The Lantern Keepers',
  author: 'Mara Quill',
  file: createVaultPath('Library/The Lantern Keepers.pdf'),
});

const AREA: NewHighlight = {
  quote: '',
  image: 'attachments/The Lantern Keepers p4 area.png',
  anchor: {
    kind: 'pdf',
    page: 4,
    quote: null,
    rects: [{ x: 0.1, y: 0.4, width: 0.6, height: 0.3 }],
  },
  comment: 'The harbour map.',
};

const append = (highlight: NewHighlight, text = SOURCE) =>
  appendHighlights({ text, highlights: [highlight], random: () => 0.5, noteBlocks });

describe('an area highlight', () => {
  it('embeds its picture as the quote, and reads back as a highlight with its box', () => {
    const { text, highlights } = append(AREA);
    expect(text).toContain(
      '> ![[attachments/The Lantern Keepers p4 area.png]]\n> <!-- atlas:highlight',
    );
    const [block] = readHighlights(text, noteBlocks);
    expect(block?.id).toBe(highlights[0]?.id);
    expect(block?.quote).toBe('![[attachments/The Lantern Keepers p4 area.png]]');
    expect(block?.comment).toBe('The harbour map.');
    expect(block?.anchor).toEqual(AREA.anchor);
  });

  it('is added once, by its page and box', () => {
    const once = append(AREA).text;
    const again = append(AREA, once);
    expect(again.highlights[0]?.added).toBe(false);
    expect(again.text).toBe(once);
  });

  it('is known to be held before anything is made for it, whatever picture it would embed', () => {
    const once = append(AREA);
    const elsewhere = { ...AREA, image: 'attachments/another name.png' };
    expect(heldHighlight({ text: once.text, highlight: elsewhere, noteBlocks })).toBe(
      once.highlights[0]?.id,
    );
    expect(heldHighlight({ text: SOURCE, highlight: AREA, noteBlocks })).toBeNull();
    const moved = { ...AREA, anchor: { ...AREA.anchor, page: 5 } };
    expect(heldHighlight({ text: once.text, highlight: moved, noteBlocks })).toBeNull();
  });

  it('refuses a picture a link could not name', () => {
    for (const image of ['attachments/a#b.png', 'a]].png', 'two\nlines.png', '  ']) {
      expect(() => append({ ...AREA, image })).toThrow(UnsafeSourceFileError);
    }
  });

  it('puts words given beside a picture after it', () => {
    const { text } = append({ ...AREA, quote: 'Harbour map' });
    expect(readHighlights(text, noteBlocks)[0]?.quote).toBe(
      '![[attachments/The Lantern Keepers p4 area.png]]\n\nHarbour map',
    );
  });
});

describe('the file a literature note names', () => {
  it('reads a link, an aliased link, or a bare path, and nothing from a blank or a bad path', () => {
    expect(literatureFileOf('[[Library/A.pdf]]')).toBe('Library/A.pdf');
    expect(literatureFileOf('[[Library/A.pdf|the book]]')).toBe('Library/A.pdf');
    expect(literatureFileOf('Library/A.pdf')).toBe('Library/A.pdf');
    expect(literatureFileOf('  ')).toBeNull();
    expect(literatureFileOf(['Library/A.pdf'])).toBeNull();
    expect(literatureFileOf('[[../outside.pdf]]')).toBeNull();
  });
});
