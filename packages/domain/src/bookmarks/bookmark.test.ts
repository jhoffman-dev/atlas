import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { pageThumbnailSrc } from '../thumbnails/page-thumbnail.ts';
import {
  BOOKMARK_MARKER,
  MAX_BOOKMARK_SUMMARY,
  bookmarkCard,
  bookmarkNode,
  bookmarkPictures,
  bookmarkTarget,
  isBookmarkMarker,
  linkOfNode,
  linkSwitchFor,
  missingBookmark,
  nestedBlockOf,
  noteSummary,
  paragraphOfBookmark,
  paragraphWithBookmark,
} from './index.ts';

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const link = (target: string, extra: Record<string, unknown> = {}): EditorNode => ({
  type: 'wikiLink',
  attrs: { target, heading: null, alias: null, ...extra },
});
const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });
const bookmark = (target: string): EditorNode => ({
  type: 'bookmark',
  attrs: { target, heading: null, alias: null },
});

describe('the bookmark marker', () => {
  it('is the comment Atlas writes', () => {
    expect(BOOKMARK_MARKER).toBe('<!-- atlas:bookmark -->');
    expect(isBookmarkMarker(BOOKMARK_MARKER)).toBe(true);
  });

  it('is read with any spacing inside the comment', () => {
    expect(isBookmarkMarker('<!--atlas:bookmark-->')).toBe(true);
    expect(isBookmarkMarker('<!--   atlas:bookmark\t-->')).toBe(true);
  });

  it('is not any other comment', () => {
    expect(isBookmarkMarker('<!-- bookmark -->')).toBe(false);
    expect(isBookmarkMarker('<!-- atlas:bookmarks -->')).toBe(false);
    expect(isBookmarkMarker('<!-- atlas:bookmark --> and more')).toBe(false);
    expect(isBookmarkMarker('<span>atlas:bookmark</span>')).toBe(false);
  });
});

describe('a bookmark node', () => {
  it('holds the link, heading and alias included', () => {
    const node = bookmarkNode({ target: 'Trip', heading: '#Days', alias: 'the trip' });
    expect(node).toEqual({
      type: 'bookmark',
      attrs: { target: 'Trip', heading: '#Days', alias: 'the trip' },
    });
    expect(linkOfNode(node)).toEqual({ target: 'Trip', heading: '#Days', alias: 'the trip' });
  });

  it('reads anything that is not text in its attributes as absent', () => {
    expect(linkOfNode({ type: 'bookmark', attrs: { target: 3, heading: false } })).toEqual({
      target: '',
      heading: null,
      alias: null,
    });
    expect(linkOfNode({ type: 'bookmark' })).toEqual({ target: '', heading: null, alias: null });
  });
});

describe('paragraphWithBookmark', () => {
  it('turns a paragraph holding only the link into the bookmark alone', () => {
    expect(paragraphWithBookmark(paragraph(link('Trip')), 0)).toEqual([bookmark('Trip')]);
  });

  it('keeps the link heading and alias', () => {
    const [only] = paragraphWithBookmark(paragraph(link('Trip', { alias: 'go' })), 0) ?? [];
    expect(only?.attrs).toEqual({ target: 'Trip', heading: null, alias: 'go' });
  });

  it('splits a sentence around the link, dropping the spaces it stood between', () => {
    const split = paragraphWithBookmark(
      paragraph(text('See '), link('Trip'), text(' for the days.')),
      1,
    );
    expect(split).toEqual([
      paragraph(text('See')),
      bookmark('Trip'),
      paragraph(text('for the days.')),
    ]);
  });

  it('leaves out a side that is only spaces and line breaks', () => {
    const split = paragraphWithBookmark(
      paragraph(text('  '), { type: 'hardBreak' }, link('Trip'), { type: 'hardBreak' }, text(' ')),
      2,
    );
    expect(split).toEqual([bookmark('Trip')]);
  });

  it('keeps marks on the text either side', () => {
    const bold = [{ type: 'bold' }];
    const split = paragraphWithBookmark(
      paragraph({ type: 'text', text: 'Bold ', marks: bold }, link('Trip')),
      1,
    );
    expect(split?.[0]).toEqual(paragraph({ type: 'text', text: 'Bold', marks: bold }));
  });

  it('refuses anything but a wiki link in a paragraph', () => {
    expect(paragraphWithBookmark(paragraph(text('x')), 0)).toBeNull();
    expect(paragraphWithBookmark(paragraph(link('Trip')), 1)).toBeNull();
    expect(paragraphWithBookmark(paragraph(link('Pic', { embed: true })), 0)).toBeNull();
    expect(paragraphWithBookmark({ type: 'heading', content: [link('Trip')] }, 0)).toBeNull();
  });
});

describe('paragraphOfBookmark', () => {
  it('gives back the link alone in a paragraph', () => {
    expect(paragraphOfBookmark(bookmark('Trip'))).toEqual(paragraph(link('Trip')));
  });

  it('keeps the heading and alias, and round-trips with paragraphWithBookmark', () => {
    const original = paragraph(link('Trip', { heading: '#Days', alias: 'days' }));
    const [card] = paragraphWithBookmark(original, 0) ?? [];
    expect(paragraphOfBookmark(card!)).toEqual(original);
  });

  it('refuses anything that is not a bookmark', () => {
    expect(paragraphOfBookmark(paragraph(link('Trip')))).toBeNull();
  });
});

describe('noteSummary', () => {
  it('prefers the description, then the summary property', () => {
    const body = doc(paragraph(text('First words.')));
    expect(noteSummary({ properties: { description: ' Why ', summary: 'no' }, doc: body })).toBe(
      'Why',
    );
    expect(noteSummary({ properties: { summary: 'The gist' }, doc: body })).toBe('The gist');
  });

  it('passes over an empty or non-text property to the first paragraph', () => {
    const body = doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
      paragraph(),
      paragraph(
        text('Opening '),
        link('Julie', { alias: 'J' }),
        { type: 'hardBreak' },
        text('then'),
      ),
    );
    expect(noteSummary({ properties: { description: '  ', summary: 3 }, doc: body })).toBe(
      'Opening J then',
    );
  });

  it('reads an image in the paragraph as its description', () => {
    const body = doc(paragraph({ type: 'image', attrs: { src: 'a.png', alt: 'A map' } }));
    expect(noteSummary({ properties: {}, doc: body })).toBe('A map');
  });

  it('is empty for a note with no prose', () => {
    expect(noteSummary({ properties: {}, doc: doc({ type: 'horizontalRule' }) })).toBe('');
  });

  it('cuts a long one at a word, with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end`;
    const summary = noteSummary({ properties: { description: long }, doc: doc() });
    expect(summary.length).toBeLessThanOrEqual(MAX_BOOKMARK_SUMMARY);
    expect(summary.endsWith('word…')).toBe(true);
  });

  it('cuts one long word where it must', () => {
    const summary = noteSummary({ properties: { description: 'x'.repeat(400) }, doc: doc() });
    expect(summary).toBe(`${'x'.repeat(MAX_BOOKMARK_SUMMARY - 1)}…`);
  });

  it('leaves one exactly at the limit whole', () => {
    const exact = 'y'.repeat(MAX_BOOKMARK_SUMMARY);
    expect(noteSummary({ properties: { description: exact }, doc: doc() })).toBe(exact);
  });
});

describe('bookmarkPictures', () => {
  const path = createVaultPath('Trips/Rome.md');

  it('puts the picture of the page first when the thumbnail is auto, then the cover', () => {
    expect(
      bookmarkPictures({
        path,
        properties: { thumbnail: 'auto', cover: 'art/rome.png' },
        doc: doc(),
        thumbnailKey: 'thumbnail',
      }),
    ).toEqual([pageThumbnailSrc(path), 'art/rome.png']);
  });

  it('uses a chosen thumbnail, then the first image in the body', () => {
    expect(
      bookmarkPictures({
        path,
        properties: { thumbnail: 'pic.png' },
        doc: doc(paragraph({ type: 'image', attrs: { src: 'first.png' } })),
        thumbnailKey: 'thumbnail',
      }),
    ).toEqual(['pic.png', 'first.png']);
  });

  it('names a picture once when both routes lead to it', () => {
    expect(
      bookmarkPictures({ path, properties: { cover: 'c.png' }, doc: doc(), thumbnailKey: null }),
    ).toEqual(['c.png']);
  });

  it('has none for a note without a thumbnail, cover or image', () => {
    expect(bookmarkPictures({ path, properties: {}, doc: doc(), thumbnailKey: null })).toEqual([]);
  });
});

describe('bookmarkCard', () => {
  it('shows the note as its page does: title, summary, place and pictures', () => {
    const card = bookmarkCard({
      path: createVaultPath('Trips/Rome.md'),
      properties: { title: 'Rome in May', description: 'Ten days.' },
      doc: doc(),
      thumbnailKey: null,
    });
    expect(card).toEqual({
      kind: 'note',
      path: 'Trips/Rome.md',
      title: 'Rome in May',
      summary: 'Ten days.',
      place: 'Trips',
      archived: false,
      pictures: [],
    });
  });

  it('titles a note by its file name when it names no title, and knows the Archive', () => {
    const card = bookmarkCard({
      path: createVaultPath('Archive/Trips/Oslo.md'),
      properties: {},
      doc: doc(paragraph(text('Cold.'))),
      thumbnailKey: null,
    });
    expect(card).toMatchObject({ title: 'Oslo', summary: 'Cold.', archived: true });
  });

  it('says which note is missing by the link as it reads', () => {
    expect(missingBookmark({ target: 'Gone', heading: null, alias: 'the gone one' })).toEqual({
      kind: 'missing',
      label: 'the gone one',
    });
  });
});

describe('which way a link can switch (linkSwitchFor)', () => {
  const top = { parent: 'paragraph', depth: 1 };

  it('turns a bookmark back into a link, wherever it is', () => {
    expect(linkSwitchFor({ node: bookmark('Rome'), ...top })).toBe('link');
  });

  it('offers a card for a link in one of the note’s own paragraphs', () => {
    expect(linkSwitchFor({ node: link('Rome'), ...top })).toBe('bookmark');
    // `[[#Plans]]`, a link to a heading in the same note, is a card of that note.
    expect(linkSwitchFor({ node: link('', { heading: '#Plans' }), ...top })).toBe('bookmark');
  });

  it('offers nothing for an embed, for words, or for a link a card cannot stand in for', () => {
    expect(linkSwitchFor({ node: link('Rome', { embed: true }), ...top })).toBeNull();
    expect(linkSwitchFor({ node: text('Rome'), ...top })).toBeNull();
    expect(linkSwitchFor({ node: null, ...top })).toBeNull();
    // Nested in a list, a quote or a table, or in a heading: a card is a top-level block only.
    expect(linkSwitchFor({ node: link('Rome'), parent: 'paragraph', depth: 2 })).toBeNull();
    expect(linkSwitchFor({ node: link('Rome'), parent: 'heading', depth: 1 })).toBeNull();
  });
});

describe('a bookmark nested in another block (nestedBlockOf)', () => {
  // ADR-0020: a card is a top-level block. Held anywhere else, it is written as its link.
  it('is its link, alone in a paragraph', () => {
    const card: EditorNode = {
      type: 'bookmark',
      attrs: { target: 'Rome', heading: '#Days', alias: 'the days' },
    };
    expect(nestedBlockOf(card)).toEqual(
      paragraph({
        type: 'wikiLink',
        attrs: { target: 'Rome', heading: '#Days', alias: 'the days' },
      }),
    );
  });

  it('leaves every other block as it is', () => {
    const block = paragraph(text('Rome'));
    expect(nestedBlockOf(block)).toBe(block);
  });
});

describe('the note a bookmark opens (bookmarkTarget)', () => {
  const holder = createVaultPath('Plans.md');
  const rome = createVaultPath('Trips/Rome.md');
  const notePaths = [holder, rome];

  it('is the note its link names', () => {
    const link = { target: 'rome', heading: '#Days', alias: null };
    expect(bookmarkTarget({ link, holder, notePaths })).toBe(rome);
  });

  it('is the note it is in, for a link to one of its own headings', () => {
    const link = { target: '', heading: '#Packing', alias: null };
    expect(bookmarkTarget({ link, holder, notePaths })).toBe(holder);
  });

  it('is none for a link that names no note', () => {
    expect(
      bookmarkTarget({ link: { target: 'Paris', heading: null, alias: null }, holder, notePaths }),
    ).toBeNull();
    expect(
      bookmarkTarget({ link: { target: '', heading: null, alias: null }, holder, notePaths }),
    ).toBeNull();
  });
});
