import { describe, expect, it, vi } from 'vitest';
import {
  createVaultPath,
  highlightMarker,
  literatureNoteText,
  type HighlightAnchor,
  type LiteratureNote,
} from '@dfai/domain';
import { fakeIndexPort, fakeVaultFs } from '../testing/fake-ports.ts';
import { memoryFiles, readerMarkdown } from '../testing/fake-reader.ts';
import { createTransclusionReader } from '../transclusion/read-transclusions.ts';
import {
  linkedPdf,
  openHighlightPlace,
  readerHighlightLinks,
  whereHighlightOpens,
  type HighlightPlaceOpener,
} from './open-highlight-place.ts';

/*
 * Following a highlight back to its place (#506): a PDF's opens its reader,
 * a Kindle book's its note at the block; the embeds of highlights name
 * their source; and `[[…pdf]]` finds the PDF it names.
 */

const PDF = createVaultPath('Library/the-lantern-keepers.pdf');
const PDF_NOTE = createVaultPath('Library/The Lantern Keepers.md');
const KINDLE_NOTE = createVaultPath('Library/Brightwater.md');
const PLAIN_NOTE = createVaultPath('Trips/Plans.md');

const PAGE_THREE: HighlightAnchor = {
  kind: 'pdf',
  page: 3,
  quote: { exact: 'The last lamp', prefix: '', suffix: '' },
  rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.02 }],
};
const LOCATION_41: HighlightAnchor = {
  kind: 'kindle',
  location: { start: 41, end: 44 },
  annotationId: null,
};

const highlightText = (id: string, anchor: HighlightAnchor) =>
  `> Quote ${id}.\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor })}\n\n^${id}\n`;

const note = (source: LiteratureNote, ...blocks: string[]) =>
  [literatureNoteText(source), ...blocks].join('\n');

function vault() {
  return memoryFiles({
    [PDF_NOTE]: note(
      { kind: 'pdf', title: 'The Lantern Keepers', author: 'Mara Quill', file: PDF },
      highlightText('k3x9q2', PAGE_THREE),
      'A paragraph of my own. ^mine01\n',
    ),
    [KINDLE_NOTE]: note(
      { kind: 'kindle', title: 'Brightwater', author: 'Tobias Fenn', file: null },
      highlightText('kd0041', LOCATION_41),
    ),
    [PLAIN_NOTE]: `${highlightText('q1q1q1', PAGE_THREE)}`,
  });
}

const ports = () => ({ fs: vault().fs, markdown: readerMarkdown() });

describe('where following a block of a note leads', () => {
  it("is a PDF's reader, at the highlight", async () => {
    expect(await whereHighlightOpens(ports(), { note: PDF_NOTE, blockId: 'k3x9q2' })).toEqual({
      kind: 'reader',
      source: 'pdf',
      document: PDF,
      highlightId: 'k3x9q2',
    });
  });

  it("is a Kindle highlight's note, at the block", async () => {
    expect(await whereHighlightOpens(ports(), { note: KINDLE_NOTE, blockId: 'kd0041' })).toEqual({
      kind: 'note',
      note: KINDLE_NOTE,
      blockId: 'kd0041',
    });
  });

  it("is the note for a block of a PDF's note that is not a highlight", async () => {
    expect(await whereHighlightOpens(ports(), { note: PDF_NOTE, blockId: 'mine01' })).toEqual({
      kind: 'note',
      note: PDF_NOTE,
      blockId: 'mine01',
    });
  });

  it('is the note for a quote in a note that is no literature note, marker or not', async () => {
    expect(await whereHighlightOpens(ports(), { note: PLAIN_NOTE, blockId: 'q1q1q1' })).toEqual({
      kind: 'note',
      note: PLAIN_NOTE,
      blockId: 'q1q1q1',
    });
  });

  it('is the note when the note cannot be read: its page then says why', async () => {
    const missing = createVaultPath('Library/Gone.md');
    expect(await whereHighlightOpens(ports(), { note: missing, blockId: 'k3x9q2' })).toEqual({
      kind: 'note',
      note: missing,
      blockId: 'k3x9q2',
    });
  });
});

describe('opening a highlight where it lives', () => {
  const opener = () => ({
    openDocument: vi.fn<HighlightPlaceOpener['openDocument']>(),
    openNote: vi.fn<HighlightPlaceOpener['openNote']>(),
  });

  it("opens a PDF's highlight in its reader and nothing else", async () => {
    const opens = opener();
    await openHighlightPlace(
      { ...ports(), opener: opens },
      { note: PDF_NOTE, highlightId: 'k3x9q2' },
    );
    expect(opens.openDocument).toHaveBeenCalledWith({ path: PDF, highlightId: 'k3x9q2' });
    expect(opens.openNote).not.toHaveBeenCalled();
  });

  it('opens a Kindle highlight at its block in its note and nothing else', async () => {
    const opens = opener();
    const opened = await openHighlightPlace(
      { ...ports(), opener: opens },
      { note: KINDLE_NOTE, highlightId: 'kd0041' },
    );
    expect(opens.openNote).toHaveBeenCalledWith({ path: KINDLE_NOTE, blockId: 'kd0041' });
    expect(opens.openDocument).not.toHaveBeenCalled();
    expect(opened.kind).toBe('note');
  });
});

describe('which highlights of an open note offer "Open in PDF"', () => {
  const linksOf = (path: string) => {
    const text = vault().files.get(path) as string;
    const properties = readerMarkdown().frontmatterProperties(
      text.slice(4, text.indexOf('\n---\n')),
    );
    return readerHighlightLinks(readerMarkdown(), { properties, text });
  };

  it("is every highlight of a PDF's literature note, and no other block", () => {
    const links = linksOf(PDF_NOTE);
    expect(links?.label).toBe('Open in PDF');
    expect([...(links?.ids ?? [])]).toEqual(['k3x9q2']);
  });

  it("is none in a Kindle book's note", () => {
    expect(linksOf(KINDLE_NOTE)).toBeNull();
  });

  it('is none in a note that is no literature note', () => {
    expect(
      readerHighlightLinks(readerMarkdown(), {
        properties: {},
        text: highlightText('q1q1q1', PAGE_THREE),
      }),
    ).toBeNull();
  });
});

describe("an embed of a literature note's highlight", () => {
  it('names its source and page; an embed of any other block names none', async () => {
    const { fs } = vault();
    const raw = (anchor: string) => ({ type: 'rawBlock', attrs: { markdown: '> Quote.', anchor } });
    const markdown = {
      ...readerMarkdown(),
      parseBody: () => ({
        blocks: [],
        doc: { type: 'doc' as const, content: [raw('k3x9q2'), raw('mine01')] },
      }),
    };
    const reader = createTransclusionReader({ fs, markdown, index: fakeIndexPort() });
    const [highlight, other] = await reader.read({
      holder: PLAIN_NOTE,
      notePaths: [PDF_NOTE, PLAIN_NOTE],
      links: [
        { target: 'The Lantern Keepers', heading: '#^k3x9q2', alias: null },
        { target: 'The Lantern Keepers', heading: '#^mine01', alias: null },
      ],
    });
    expect(highlight?.kind === 'block' ? highlight.highlight : 'not shown').toEqual({
      kind: 'pdf',
      hue: 'red',
      title: 'The Lantern Keepers',
      place: 'p. 3',
      opensInReader: true,
    });
    expect(other?.kind === 'block' ? other.highlight : 'not shown').toBeNull();
  });
});

describe('the PDF a `[[…pdf]]` link names', () => {
  const files = (extra: Record<string, string | Uint8Array> = {}) =>
    memoryFiles({
      [PDF]: new Uint8Array([1]),
      'Library/Courses/reading.pdf': new Uint8Array([1]),
      'Elsewhere/Deep/Fog.pdf': new Uint8Array([1]),
      [PLAIN_NOTE]: 'Plans\n',
      ...extra,
    }).fs;

  it('is a PDF of the vault by its name alone, though no literature note names it', async () => {
    expect(await linkedPdf({ fs: files() }, 'fog.pdf')).toBe('Elsewhere/Deep/Fog.pdf');
  });

  it('is the PDF whose path ends as the link is written, as Obsidian reads it', async () => {
    expect(await linkedPdf({ fs: files() }, 'Courses/reading.pdf')).toBe(
      'Library/Courses/reading.pdf',
    );
  });

  it('is one of the PDFs the name is shared by, the same one every time', async () => {
    const shared = files({ 'reading.pdf': new Uint8Array([1]), 'Z/reading.pdf': new Uint8Array([1]) });
    expect(await linkedPdf({ fs: shared }, 'reading.pdf')).toBe('reading.pdf');
  });

  it('is none for a PDF the vault does not hold: a link never names a file that is not there', async () => {
    expect(await linkedPdf({ fs: files() }, 'Areas/Missing.pdf')).toBeNull();
  });

  it('is none for a link to a note, and the vault is not read for it', async () => {
    const listDirectory = vi.fn(async () => []);
    const fs = fakeVaultFs({ listDirectory });
    expect(await linkedPdf({ fs }, 'The Lantern Keepers')).toBeNull();
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it('is an error, not a guess, when the vault cannot be read', async () => {
    const fs = fakeVaultFs({
      listDirectory: async () => {
        throw new Error('the disk went away');
      },
    });
    await expect(linkedPdf({ fs }, 'fog.pdf')).rejects.toThrow('the disk went away');
  });
});
