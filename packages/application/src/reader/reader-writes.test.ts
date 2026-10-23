import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  DEFAULT_HIGHLIGHT_STYLE,
  literatureNoteText,
  readHighlights,
  type PdfAnchor,
} from '@dfai/domain';
import { lineNoteBlocks } from '@dfai/domain/testing';
import { fakeIndexPort, fakeOpenNotes } from '../testing/fake-ports.ts';
import { fakePdf, linesPage, memoryFiles, readerMarkdown } from '../testing/fake-reader.ts';
import { findLiteratureNote } from './find-literature-note.ts';
import { allPageTexts, placeHighlights } from './place-highlights.ts';
import {
  highlightArea,
  highlightSelection,
  NothingToHighlightError,
  readLiteratureNoteAt,
} from './pdf-highlights.ts';

const PDF = createVaultPath('Library/The Lantern Keepers.pdf');
const NOTE = createVaultPath('Library/The Lantern Keepers.md');
const SOURCE = literatureNoteText({
  kind: 'pdf',
  title: 'The Lantern Keepers',
  author: 'Mara Quill',
  file: PDF,
});

const PAGE_ONE = linesPage('The keepers lit the lamps at dusk.', 'A light kept is a promise kept.');
const PAGE_TWO = linesPage(
  'Fog came in from the north channel.',
  'A light kept is a promise kept.',
);

function vault(text = SOURCE) {
  const memory = memoryFiles({ [NOTE]: text, [PDF]: new Uint8Array([37]) });
  let draws = 0;
  const ports = {
    fs: memory.fs,
    markdown: readerMarkdown(),
    openNotes: fakeOpenNotes(),
    rng: { next: () => ((draws += 1) % 36) / 36 + 0.001 },
  };
  return { ...memory, ports };
}

const select = (page: number, text: string, words: string) => {
  const start = text.indexOf(words);
  return { page, start, end: start + words.length };
};

describe('highlighting picked words', () => {
  it('adds the highlight to the note, anchored to the words on their page', async () => {
    const { ports, files } = vault();
    const { id, added } = await highlightSelection(ports, {
      note: NOTE,
      selection: select(2, PAGE_TWO.text, 'north channel'),
      page: PAGE_TWO,
      style: { mark: 'underline', color: 'blue' },
      comment: 'Where the fog comes from.',
    });
    expect(added).toBe(true);
    const [block] = readHighlights(files.get(NOTE) as string, lineNoteBlocks);
    expect(block).toMatchObject({
      id,
      quote: 'north channel',
      comment: 'Where the fog comes from.',
      style: { mark: 'underline', color: 'blue' },
    });
    expect(block?.anchor).toMatchObject({
      kind: 'pdf',
      page: 2,
      quote: { exact: 'north channel' },
    });
  });

  it('refuses a selection of nothing but space, writing nothing', async () => {
    const { ports, files } = vault();
    const lineEnd = PAGE_ONE.text.indexOf('\n');
    await expect(
      highlightSelection(ports, {
        note: NOTE,
        selection: { page: 1, start: lineEnd, end: lineEnd + 1 },
        page: PAGE_ONE,
        style: DEFAULT_HIGHLIGHT_STYLE,
      }),
    ).rejects.toThrow(NothingToHighlightError);
    expect(files.get(NOTE)).toBe(SOURCE);
  });
});

describe('highlighting an area of a scanned page', () => {
  it('saves its picture among the images, then adds a highlight that shows it', async () => {
    const { ports, files } = vault();
    const picture = new Uint8Array([137, 80, 78, 71]);
    await highlightArea(ports, {
      note: NOTE,
      pdf: PDF,
      page: 4,
      box: { x: 0.1, y: 0.4, width: 0.5, height: 0.3 },
      picture: async () => picture,
      placement: 'attachments',
      style: DEFAULT_HIGHLIGHT_STYLE,
      comment: 'The harbour map.',
    });
    expect(files.get('attachments/The Lantern Keepers p4 area.png')).toEqual(picture);
    const [block] = readHighlights(files.get(NOTE) as string, lineNoteBlocks);
    expect(block?.quote).toBe('![[attachments/The Lantern Keepers p4 area.png]]');
    expect(block?.anchor).toEqual({
      kind: 'pdf',
      page: 4,
      quote: null,
      rects: [{ x: 0.1, y: 0.4, width: 0.5, height: 0.3 }],
    });
  });

  it('puts the picture beside the note when images go beside their notes, numbered past one taken', async () => {
    const { ports, files } = vault();
    files.set('Library/The Lantern Keepers p1 area.png', new Uint8Array([1]));
    await highlightArea(ports, {
      note: NOTE,
      pdf: PDF,
      page: 1,
      box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      picture: async () => new Uint8Array([2]),
      placement: 'beside-note',
      style: DEFAULT_HIGHLIGHT_STYLE,
    });
    expect(files.get('Library/The Lantern Keepers p1 area 2.png')).toEqual(new Uint8Array([2]));
  });
});

describe('reading a literature note for the reader', () => {
  it('says what it is a note of and lists its highlights', async () => {
    const { ports } = vault();
    await highlightSelection(ports, {
      note: NOTE,
      selection: select(1, PAGE_ONE.text, 'lamps'),
      page: PAGE_ONE,
      style: DEFAULT_HIGHLIGHT_STYLE,
    });
    const read = await readLiteratureNoteAt(ports, NOTE);
    expect(read.source).toMatchObject({ kind: 'pdf', title: 'The Lantern Keepers', file: PDF });
    expect(read.highlights.map((block) => block.quote)).toEqual(['lamps']);
  });

  it('reads no highlights from a note that is not a literature note', async () => {
    const { ports } = vault('---\ntype: note\n---\n\n> quote\n');
    expect(await readLiteratureNoteAt(ports, NOTE)).toEqual({ source: null, highlights: [] });
  });
});

describe("finding a PDF's literature note", () => {
  const index = (paths: string[]) =>
    fakeIndexPort({ notesOfType: async () => paths.map((path) => ({ path, title: path })) });

  it('is the literature note whose file names the PDF, the first by path of two', async () => {
    const { fs } = memoryFiles({
      'Library/Other.md': literatureNoteText({
        kind: 'pdf',
        title: 'Other',
        author: null,
        file: createVaultPath('Library/Other.pdf'),
      }),
      'Library/Z copy.md': SOURCE,
      [NOTE]: SOURCE,
    });
    const found = await findLiteratureNote(
      {
        index: index(['Library/Other.md', 'Library/Z copy.md', NOTE]),
        fs,
        markdown: readerMarkdown(),
      },
      PDF,
    );
    expect(found).toBe(NOTE);
  });

  it('is a note whose type is a list holding literature, as the Library reads it', async () => {
    const typedTwice = SOURCE.replace('type: literature', 'type: ["literature", "book"]');
    expect(typedTwice).toContain('type: ["literature", "book"]');
    const { fs } = memoryFiles({ [NOTE]: typedTwice });
    expect(
      await findLiteratureNote({ index: index([NOTE]), fs, markdown: readerMarkdown() }, PDF),
    ).toBe(NOTE);
  });

  it('is none when no literature note names it', async () => {
    const { fs } = memoryFiles({
      [NOTE]: '---\ntype: note\nfile: "[[Library/The Lantern Keepers.pdf]]"\n---\n',
    });
    expect(
      await findLiteratureNote({ index: index([NOTE]), fs, markdown: readerMarkdown() }, PDF),
    ).toBeNull();
  });
});

describe('placing the note’s highlights on the open PDF', () => {
  const block = (id: string, anchor: PdfAnchor) => ({
    id,
    quote: anchor.quote?.exact ?? '',
    comment: '',
    style: DEFAULT_HIGHLIGHT_STYLE,
    anchor,
    start: 0,
    markerEnd: 0,
    quoteEnd: 0,
    end: 0,
  });
  const words = (page: number, exact: string, prefix = ''): PdfAnchor => ({
    kind: 'pdf',
    page,
    quote: { exact, prefix, suffix: '' },
    rects: [{ x: 0.5, y: 0.5, width: 0.1, height: 0.02 }],
  });

  it('finds each by its words on its own page, reading only those pages', async () => {
    const document = fakePdf([PAGE_ONE, PAGE_TWO, linesPage('Three')]);
    const placed = await placeHighlights({
      opened: document,
      blocks: [block('b', words(2, 'north channel')), block('a', words(1, 'lamps'))],
    });
    expect(placed.map((entry) => [entry.block.id, entry.placement.kind])).toEqual([
      ['a', 'words'],
      ['b', 'words'],
    ]);
    expect([...document.textsRead].sort()).toEqual([1, 2]);
  });

  it('looks on every page for words that moved, and draws an area at its box', async () => {
    const document = fakePdf([PAGE_ONE, PAGE_TWO]);
    const area: PdfAnchor = {
      kind: 'pdf',
      page: 1,
      quote: null,
      rects: [{ x: 0.1, y: 0.9, width: 0.2, height: 0.05 }],
    };
    const placed = await placeHighlights({
      opened: document,
      blocks: [block('moved', words(1, 'north channel')), block('area', area)],
    });
    expect(placed.map((entry) => [entry.block.id, entry.placement])).toEqual([
      ['area', { kind: 'area', page: 1, rects: area.rects }],
      ['moved', expect.objectContaining({ kind: 'words', page: 2 })],
    ]);
  });

  it('draws words that are nowhere at their saved boxes, and lists one past the document as lost', async () => {
    const document = fakePdf([PAGE_ONE]);
    const placed = await placeHighlights({
      opened: document,
      blocks: [block('gone', words(9, 'harbour wall')), block('changed', words(1, 'lanterns'))],
    });
    expect(placed.map((entry) => [entry.block.id, entry.placement.kind])).toEqual([
      ['changed', 'boxes'],
      ['gone', 'lost'],
    ]);
  });

  it('still places the other pages’ highlights when one page cannot be read', async () => {
    const document = fakePdf([PAGE_ONE, PAGE_TWO]);
    const damaged = {
      ...document,
      pageText: async (page: number) => {
        if (page === 2) throw new Error('Invalid page tree');
        return document.pageText(page);
      },
    };
    const placed = await placeHighlights({
      opened: damaged,
      blocks: [block('fine', words(1, 'lamps')), block('lost-words', words(2, 'north channel'))],
    });
    expect(placed.map((entry) => [entry.block.id, entry.placement.kind])).toEqual([
      ['fine', 'words'],
      ['lost-words', 'boxes'],
    ]);
  });

  it('reads the text of a long book a few pages at a time, an unreadable page being one without words', async () => {
    let reading = 0;
    let mostAtOnce = 0;
    const long = {
      pageCount: 30,
      pageText: async (page: number) => {
        reading += 1;
        mostAtOnce = Math.max(mostAtOnce, reading);
        await Promise.resolve();
        reading -= 1;
        if (page === 3) throw new Error('damaged');
        return linesPage(`Page ${page}`);
      },
    };
    const texts = await allPageTexts(long);
    expect(texts).toHaveLength(30);
    expect(texts[2]?.text).toBe('');
    expect(texts[3]?.text).toBe('Page 4');
    expect(mostAtOnce).toBeLessThanOrEqual(8);
  });

  it('leaves out highlights that are not a PDF’s', async () => {
    const kindle = {
      ...block('k', words(1, 'x')),
      anchor: { kind: 'kindle' as const, location: { start: 1, end: null }, annotationId: null },
    };
    expect(await placeHighlights({ opened: fakePdf([PAGE_ONE]), blocks: [kindle] })).toEqual([]);
  });
});
