import { describe, expect, it } from 'vitest';
import type { HighlightAnchor, SourceKind } from '../highlights/anchor.ts';
import type { HighlightBlock } from '../highlights/highlight-block.ts';
import type { LiteratureNote } from '../highlights/literature-note.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  highlightChip,
  highlightOpening,
  pdfLinkTarget,
  placeLabel,
  readerLinkLabel,
} from './highlight-opening.ts';

/*
 * Where a followed highlight opens (#506): the reader for a source the app
 * can read, the note at the block for any other; and what its chip says.
 */

const NOTE = createVaultPath('Library/The Lantern Keepers.md');
const PDF = createVaultPath('Library/the-lantern-keepers.pdf');

const source = (overrides: Partial<LiteratureNote> = {}): LiteratureNote => ({
  kind: 'pdf',
  title: 'The Lantern Keepers',
  author: 'Mara Quill',
  file: PDF,
  ...overrides,
});

const PDF_ANCHOR: HighlightAnchor = {
  kind: 'pdf',
  page: 3,
  quote: { exact: 'The last lamp', prefix: '', suffix: '' },
  rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.02 }],
};

const highlight = (anchor: HighlightAnchor, id = 'k3x9q2'): HighlightBlock => ({
  id,
  quote: 'The last lamp',
  comment: '',
  style: { mark: 'highlight', color: 'yellow' },
  anchor,
  start: 0,
  markerEnd: 0,
  quoteEnd: 0,
  end: 0,
});

describe('where following a block opens', () => {
  const opening = (
    literature: Parameters<typeof highlightOpening>[0]['literature'],
    readers?: readonly SourceKind[],
  ) =>
    highlightOpening({
      note: NOTE,
      blockId: 'k3x9q2',
      literature,
      ...(readers !== undefined && { readers }),
    });

  it("opens a PDF's highlight in the reader, at the highlight", () => {
    expect(opening({ source: source(), highlightIds: ['a1b2c3', 'k3x9q2'] })).toEqual({
      kind: 'reader',
      source: 'pdf',
      document: PDF,
      highlightId: 'k3x9q2',
    });
  });

  it('opens a Kindle highlight in its note at the block: a Kindle book has no reader', () => {
    expect(
      opening({ source: source({ kind: 'kindle', file: null }), highlightIds: ['k3x9q2'] }),
    ).toEqual({ kind: 'note', note: NOTE, blockId: 'k3x9q2' });
  });

  it('opens an EPUB highlight in its note until the EPUB reader is one of the readers (#505)', () => {
    const epub = {
      source: source({ kind: 'epub', file: createVaultPath('Library/b.epub') }),
      highlightIds: ['k3x9q2'],
    };
    expect(opening(epub)).toEqual({ kind: 'note', note: NOTE, blockId: 'k3x9q2' });
    expect(opening(epub, ['pdf', 'epub'])).toEqual({
      kind: 'reader',
      source: 'epub',
      document: 'Library/b.epub',
      highlightId: 'k3x9q2',
    });
  });

  it('opens a block of a literature note that is not a highlight in the note', () => {
    expect(opening({ source: source(), highlightIds: ['a1b2c3'] })).toEqual({
      kind: 'note',
      note: NOTE,
      blockId: 'k3x9q2',
    });
  });

  it('opens a block of any other note in the note', () => {
    expect(opening(null)).toEqual({ kind: 'note', note: NOTE, blockId: 'k3x9q2' });
  });

  it('opens a PDF literature note with no file in the note: there is no document to read', () => {
    expect(opening({ source: source({ file: null }), highlightIds: ['k3x9q2'] })).toEqual({
      kind: 'note',
      note: NOTE,
      blockId: 'k3x9q2',
    });
  });
});

describe('what a highlight in its note offers', () => {
  it('is "Open in PDF" for a PDF with its file', () => {
    expect(readerLinkLabel(source())).toBe('Open in PDF');
  });

  it('is nothing for a Kindle book, a PDF with no file, or a note that is no literature note', () => {
    expect(readerLinkLabel(source({ kind: 'kindle', file: null }))).toBeNull();
    expect(readerLinkLabel(source({ file: null }))).toBeNull();
    expect(readerLinkLabel(null)).toBeNull();
  });

  it('is "Open in EPUB" once the EPUB reader is one of the readers', () => {
    const epub = source({ kind: 'epub', file: createVaultPath('Library/b.epub') });
    expect(readerLinkLabel(epub)).toBeNull();
    expect(readerLinkLabel(epub, ['pdf', 'epub'])).toBe('Open in EPUB');
  });
});

describe('where in its source a highlight is', () => {
  it("names a PDF highlight's page", () => {
    expect(placeLabel(PDF_ANCHOR)).toBe('p. 3');
  });

  it("names a Kindle highlight's location, or its page when the export gave no location", () => {
    expect(
      placeLabel({ kind: 'kindle', location: { start: 1234, end: 1240 }, annotationId: null }),
    ).toBe('loc. 1234');
    expect(placeLabel({ kind: 'kindle', location: null, page: 17, annotationId: null })).toBe(
      'p. 17',
    );
    expect(placeLabel({ kind: 'kindle', location: null, annotationId: null })).toBeNull();
  });

  it('names no place for an EPUB, whose CFI means nothing read', () => {
    expect(
      placeLabel({ kind: 'epub', cfi: 'epubcfi(/6/4!/4/2)', quote: PDF_ANCHOR.quote! }),
    ).toBeNull();
  });
});

describe("a shown highlight's chip", () => {
  it("says the source's title and page, in its kind's hue, and that it opens the reader", () => {
    expect(highlightChip(source(), highlight(PDF_ANCHOR))).toEqual({
      kind: 'pdf',
      hue: 'red',
      title: 'The Lantern Keepers',
      place: 'p. 3',
      opensInReader: true,
    });
  });

  it("says a Kindle highlight's location, in another hue, and that it opens its note", () => {
    const kindle = highlight({
      kind: 'kindle',
      location: { start: 41, end: 44 },
      annotationId: null,
    });
    expect(highlightChip(source({ kind: 'kindle', file: null }), kindle)).toEqual({
      kind: 'kindle',
      hue: 'orange',
      title: 'The Lantern Keepers',
      place: 'loc. 41',
      opensInReader: false,
    });
  });
});

describe('the PDF a wiki link names', () => {
  const known = [
    PDF,
    createVaultPath('Archive/the-lantern-keepers.pdf'),
    createVaultPath('Areas/Fog.pdf'),
  ];

  it('is none for a link to anything but a PDF', () => {
    expect(pdfLinkTarget('The Lantern Keepers', known)).toBeNull();
    expect(pdfLinkTarget('notes.pdf.md', known)).toBeNull();
  });

  it('is the known PDF at the path the link writes, in any case', () => {
    expect(pdfLinkTarget('library/The-Lantern-Keepers.PDF', known)).toBe(PDF);
    expect(pdfLinkTarget(' /Library/the-lantern-keepers.pdf ', known)).toBe(PDF);
  });

  it('is the one known PDF of the name a link gives alone', () => {
    expect(pdfLinkTarget('fog.pdf', known)).toBe('Areas/Fog.pdf');
  });

  it('is the path the link writes when the name is two PDFs, or none', () => {
    expect(pdfLinkTarget('the-lantern-keepers.pdf', known)).toBe('the-lantern-keepers.pdf');
    expect(pdfLinkTarget('Elsewhere/new.pdf', known)).toBe('Elsewhere/new.pdf');
  });

  it('is none for a link that is no vault path', () => {
    expect(pdfLinkTarget('../outside.pdf', known)).toBeNull();
    expect(pdfLinkTarget('a\\b.pdf', known)).toBeNull();
  });
});
