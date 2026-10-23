import { describe, expect, it } from 'vitest';
import { literatureHighlightReader, type HighlightBlockReader } from '@dfai/application';
import {
  appendHighlights,
  areaHighlight,
  BLOCK_ANCHOR_ATTR,
  commentLines,
  isTombstoneBlock,
  kindleHighlightKey,
  kindleNoteKey,
  literatureNoteText,
  readHighlights,
  splitFrontmatter,
  withHighlightComment,
  withKindleHighlights,
  withoutHighlight,
  type EditorDocument,
  type HighlightView,
  type KindleHighlight,
  type NewHighlight,
  type VaultPath,
} from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';
import { noteBlocks } from './note-blocks.ts';

/*
 * A literature note in DFAI's editor (#523): every highlight drawn as its
 * quote and comment, every tombstone hidden, and the note saved back byte for
 * byte when nothing was edited — whatever wrote it: DFAI's readers, Kindle
 * sync, or a person in Obsidian with Windows line endings, lazy lines and
 * `%%` comments. A comment edited in place goes through the literature
 * note's own write, which changes only the comment's bytes; the editor then
 * reads and saves that note byte for byte too.
 */

/** A fixed random source: the same ids on every run. */
function drawn(): () => number {
  let at = 0;
  return () => ((at++ * 7 + 3) % 36) / 36;
}

const PDF: NewHighlight = {
  quote: 'All warfare is based on *deception*. #tactics',
  anchor: {
    kind: 'pdf',
    page: 3,
    quote: { exact: 'All warfare is based on deception.', prefix: '', suffix: ' Hence' },
    rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.02 }],
  },
  style: { mark: 'highlight', color: 'green' },
  comment: 'The line every summary quotes. Compare [[Larkspur Payroll]].',
};
const EPUB: NewHighlight = {
  quote: 'Call me Ishmael.',
  anchor: {
    kind: 'epub',
    cfi: 'epubcfi(/6/8!/4/2/1:0)',
    quote: { exact: 'Call me Ishmael.', prefix: '', suffix: ' Some' },
  },
  style: { mark: 'underline', color: 'purple' },
  comment: '50%% sure, and %%private%% too.',
};
const KINDLE: NewHighlight = {
  quote: 'It is a truth universally acknowledged.',
  anchor: { kind: 'kindle', location: { start: 77, end: 79 }, annotationId: 'A1' },
};
const AREA = areaHighlight({
  page: 4,
  box: { x: 0, y: 0.1, width: 1, height: 0.3 },
  image: 'attachments/The Lantern Keepers p4 area.png',
  style: { mark: 'highlight', color: 'blue' },
  comment: 'The map on the endpaper.',
});

const pdfNote = (prose = 'My own paragraph.\n') =>
  appendHighlights({
    text: `${literatureNoteText({ kind: 'pdf', title: 'The Lantern Keepers', author: 'Mara Quill', file: 'Library/The Lantern Keepers.pdf' as VaultPath })}# The Lantern Keepers\n\n${prose}`,
    highlights: [PDF, EPUB, KINDLE, AREA],
    random: drawn(),
    noteBlocks,
  }).text;

const ASIN = 'B0EXAMPLE1';
const kindlePassage = (id: string, quote: string, location: number): KindleHighlight => ({
  key: kindleHighlightKey({ asin: ASIN, annotationId: id, location, words: quote }),
  asin: ASIN,
  annotationId: id,
  style: 'highlight',
  colour: 'pink',
  quote,
  note: null,
  location,
  page: null,
  commentOn: null,
});
const typedOn = (on: KindleHighlight, note: string): KindleHighlight => ({
  ...on,
  key: kindleNoteKey(on.key, note),
  style: 'note',
  colour: null,
  quote: '',
  note,
  commentOn: on.key,
});

/** A Kindle book's note as the sync writes it (#508), one passage then removed by the person. */
function kindleNote(): string {
  const vanity = kindlePassage('A1', 'Vanity and pride are different things.', 100);
  const gone = kindlePassage('A2', 'A passage the person removed.', 140);
  const synced = withKindleHighlights({
    text: literatureNoteText({
      kind: 'kindle',
      title: 'Brightwater',
      author: 'Tobias Fenn',
      asin: ASIN,
      file: null,
    }),
    asin: ASIN,
    highlights: [vanity, typedOn(vanity, 'Mary, of all people. 50%% of it.'), gone],
    random: drawn(),
    noteBlocks,
  }).text;
  const removed = readHighlights(synced, noteBlocks).find((block) =>
    block.quote.includes('removed'),
  );
  return withoutHighlight({ text: synced, id: removed?.id ?? '', noteBlocks });
}

/** The comment's lines with their `>` taken off, as Obsidian may leave them: lazy lines. */
const withLazyComments = (text: string): string =>
  readHighlights(text, noteBlocks)
    .reverse()
    .reduce(
      (note, block) =>
        note.slice(0, block.markerEnd) +
        note.slice(block.markerEnd, block.quoteEnd).replace(/^> (?=\S)/gm, '') +
        note.slice(block.quoteEnd),
      text,
    );

const CASES: readonly (readonly [string, () => string])[] = [
  ['a note DFAI wrote: PDF, EPUB, Kindle and area highlights', () => pdfNote()],
  ['the same note with Windows line endings', () => pdfNote().replace(/\n/g, '\r\n')],
  ['the same note with lazy comment lines', () => withLazyComments(pdfNote())],
  [
    'a note with `%%` comments between and around its highlights',
    () => pdfNote('A %%hidden aside%% in prose.\n\n%%\nA hidden block.\n%%\n'),
  ],
  ['a Kindle book as the sync writes it, with a tombstone', kindleNote],
  ['a Kindle book with no final newline', () => kindleNote().replace(/\n+$/, '')],
  ['a note that starts with a byte order mark', () => `\uFEFF${pdfNote()}`],
];

const save = (body: string, doc: EditorDocument) =>
  remarkMarkdown.serializeBody({
    originalBody: body,
    parsed: remarkMarkdown.parseBody(body),
    doc,
  });

function readerOf(text: string): HighlightBlockReader | null {
  const { frontmatter } = splitFrontmatter(text);
  const properties = remarkMarkdown.frontmatterProperties(frontmatter);
  return literatureHighlightReader(remarkMarkdown, { properties, text });
}

/** What the editor draws: each raw block with an id, as the highlight it is or as its source. */
function drawnBlocks(text: string): { id: string; view: HighlightView | null }[] {
  const reader = readerOf(text);
  const { doc } = remarkMarkdown.parseBody(splitFrontmatter(text).body);
  return doc.content.flatMap((node) => {
    const id = node.attrs?.[BLOCK_ANCHOR_ATTR];
    if (node.type !== 'rawBlock' || typeof id !== 'string') return [];
    const markdown = String(node.attrs?.['markdown'] ?? '');
    return [{ id, view: reader?.({ markdown, id }) ?? null }];
  });
}

const rawBlocksOf = (text: string): string[] =>
  remarkMarkdown
    .parseBody(splitFrontmatter(text).body)
    .doc.content.filter((node) => node.type === 'rawBlock')
    .map((node) => String(node.attrs?.['markdown'] ?? ''));

describe('a literature note opened and saved with no edits', () => {
  it('is tried on notes that hold what each case is named for', () => {
    const note = pdfNote();
    expect(note).toContain('![[attachments/The Lantern Keepers p4 area.png]]');
    expect(note).toMatch(/%\\?%/);
    expect(note.replace(/\n/g, '\r\n')).toContain('-->\r\n>\r\n> ');
    const lazy = withLazyComments(note);
    expect(lazy).not.toBe(note);
    expect(lazy).toMatch(/-->\n>\nThe line every summary quotes/);
    expect(kindleNote()).toContain('<!-- atlas:highlight-removed ');
    expect(kindleNote()).toContain('Mary, of all people.');
  });

  it.each(CASES)('is byte-identical: %s', (_label, make) => {
    const text = make();
    const { body } = splitFrontmatter(text);
    expect(save(body, remarkMarkdown.parseBody(body).doc)).toBe(body);
  });

  it.each(CASES.filter(([label]) => !label.includes('byte order mark')))(
    'draws every highlight as its quote and comment, and nothing else as one: %s',
    (_label, make) => {
      const text = make();
      const highlights = readHighlights(text, noteBlocks);
      expect(highlights.length).toBeGreaterThan(0);
      const shown = drawnBlocks(text).filter((block) => block.view !== null);
      expect(shown.map((block) => block.id)).toEqual(highlights.map((block) => block.id));
      for (const [at, block] of shown.entries()) {
        expect(block.view?.comment).toBe(highlights[at]?.comment);
      }
    },
  );

  it('draws the area highlight as its picture', () => {
    const area = drawnBlocks(pdfNote()).find((block) => block.view?.picture !== null);
    expect(area?.view).toMatchObject({
      picture: 'attachments/The Lantern Keepers p4 area.png',
      words: '',
      comment: 'The map on the endpaper.',
      color: 'blue',
    });
  });

  it('draws a quote a `%%` comment hides as its source, as Obsidian hides it', () => {
    // Typed in Obsidian: DFAI's own append is refused after an unclosed `%%`.
    const text = pdfNote().replace('My own paragraph.', '%% from here on, nothing shows');
    expect(readHighlights(text, noteBlocks)).toEqual([]);
    expect(drawnBlocks(text).length).toBeGreaterThan(0);
    expect(drawnBlocks(text).every((block) => block.view === null)).toBe(true);
  });

  it('draws no highlight in a note that is no literature note', () => {
    const text = pdfNote().replace('type: literature', 'type: meeting');
    expect(readerOf(text)).toBeNull();
  });

  it("hides a removed highlight's tombstone, and only that", () => {
    const blocks = rawBlocksOf(kindleNote());
    expect(blocks.filter(isTombstoneBlock)).toHaveLength(1);
    expect(blocks.filter((block) => block.includes('atlas:highlight {'))).toHaveLength(1);
    expect(
      blocks.filter((block) => block.includes('atlas:highlight {')).some(isTombstoneBlock),
    ).toBe(false);
  });
});

describe('a comment edited in place', () => {
  it.each(CASES.filter(([label]) => !label.includes('byte order mark')))(
    'changes only the comment’s bytes, and the editor then saves the note as written: %s',
    (_label, make) => {
      const text = make();
      for (const target of readHighlights(text, noteBlocks)) {
        const comment = 'Changed in DFAI, 50%% sure.\nA second line.';
        const changed = withHighlightComment({ text, id: target.id, comment, noteBlocks });
        expect(changed.slice(0, target.markerEnd)).toBe(text.slice(0, target.markerEnd));
        expect(changed.endsWith(text.slice(target.quoteEnd))).toBe(true);
        const { body } = splitFrontmatter(changed);
        expect(save(body, remarkMarkdown.parseBody(body).doc)).toBe(body);
        const shown = drawnBlocks(changed).find((block) => block.id === target.id);
        expect(shown?.view?.comment).toBe(commentLines(comment).join('\n'));
      }
    },
  );

  it('written back as it reads, is the same bytes', () => {
    for (const [, make] of CASES) {
      const text = make();
      for (const block of drawnBlocks(text)) {
        if (block.view === null) continue;
        const again = withHighlightComment({
          text,
          id: block.id,
          comment: block.view.comment,
          noteBlocks,
        });
        expect(again).toBe(text);
      }
    }
  });
});
