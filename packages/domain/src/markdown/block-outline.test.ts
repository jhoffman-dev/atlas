import { describe, expect, it } from 'vitest';
import {
  BLOCK_PREVIEW_LENGTH,
  anchoredBlocks,
  anchorPlaces,
  anchorStyleOf,
  anchorsIn,
  blockAnchorsOf,
  blockOutline,
  fragmentContent,
  locateFragment,
  matchingOutline,
  nodeAt,
  withAnchorAt,
  withoutBlockAnchors,
} from './block-outline.ts';
import type { EditorDocument, EditorNode } from './editor-node.ts';

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string, anchor?: string): EditorNode => ({
  type: 'paragraph',
  ...(anchor !== undefined && { attrs: { anchor } }),
  ...(value === '' ? {} : { content: [text(value)] }),
});
const heading = (level: number, value: string): EditorNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const item = (value: string, anchor?: string, ...nested: EditorNode[]): EditorNode => ({
  type: 'listItem',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [paragraph(value), ...nested],
});
const bullets = (...items: EditorNode[]): EditorNode => ({ type: 'bulletList', content: items });
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

const NOTE = doc(
  heading(1, 'Plans'),
  paragraph('The summer, roughly.', 'p1'),
  bullets(item('Tent', 'i1', bullets(item('Pegs', 'i2'))), item('Stove')),
  heading(2, 'Later'),
  { type: 'blockquote', attrs: { anchor: 'q1' }, content: [paragraph('Said once.')] },
  heading(1, 'Other'),
  paragraph('Last words.'),
);

describe('anchorStyleOf', () => {
  it('puts a paragraph’s id after its text, and another block’s on a line after it', () => {
    expect(anchorStyleOf(paragraph('Words'))).toBe('inline');
    for (const type of ['blockquote', 'callout', 'codeBlock', 'table', 'bulletList', 'rawBlock']) {
      expect(anchorStyleOf({ type }), type).toBe('line');
    }
  });

  // A26-01: a heading holds an id after its words, as Obsidian writes one
  // (`block-ids.a26-01.test.ts`); an empty heading, like an empty paragraph, has none.
  it('gives none to an empty paragraph or heading, a rule, a card or an embed', () => {
    for (const node of [
      paragraph(''),
      { type: 'heading', attrs: { level: 1 } },
      { type: 'horizontalRule' },
      { type: 'bookmark' },
      { type: 'blockEmbed' },
    ]) {
      expect(anchorStyleOf(node), node.type).toBeNull();
    }
  });
});

describe('anchorPlaces', () => {
  it('lists each item with text, outermost first, then the list itself', () => {
    const list = NOTE.content[2]!;
    expect(anchorPlaces(list)).toEqual([[0], [0, 1, 0], [1], []]);
    expect(blockAnchorsOf(list)).toEqual(['i1', 'i2', null, null]);
  });

  it('gives a paragraph one place, and an empty one none', () => {
    expect(anchorPlaces(paragraph('Words'))).toEqual([[]]);
    expect(anchorPlaces(paragraph(''))).toEqual([]);
  });

  it('passes over an item that starts with no text', () => {
    const list = bullets({ type: 'listItem', content: [paragraph('')] }, item('Kept'));
    expect(anchorPlaces(list)).toEqual([[1], []]);
  });

  it('looks for items in a quote, but not in a table or code', () => {
    const quote = { type: 'blockquote', content: [bullets(item('Inside'))] };
    expect(anchorPlaces(quote)).toEqual([[0, 0], []]);
    expect(anchorPlaces({ type: 'table', content: [bullets(item('x'))] })).toEqual([[]]);
  });
});

describe('withAnchorAt and withoutBlockAnchors', () => {
  it('gives the node at a path an id, leaving the rest alone', () => {
    const given = withAnchorAt(NOTE, [2, 1], 'new1');
    expect(blockAnchorsOf(given.content[2]!)).toEqual(['i1', 'i2', 'new1', null]);
    expect(given.content[1]).toBe(NOTE.content[1]);
  });

  it('takes an id off with null', () => {
    const taken = withAnchorAt(NOTE, [1], null);
    expect(taken.content[1]?.attrs).toEqual({});
    expect(withAnchorAt(NOTE, [], 'x')).toBe(NOTE);
  });

  it('takes every id out of a block', () => {
    const bare = withoutBlockAnchors(NOTE.content[2]!);
    expect(blockAnchorsOf(bare)).toEqual([null, null, null, null]);
    expect(anchorsIn(doc(bare))).toEqual(new Set());
  });

  it('finds every id in a note', () => {
    expect(anchorsIn(NOTE)).toEqual(new Set(['p1', 'i1', 'i2', 'q1']));
  });
});

describe('blockOutline', () => {
  it('lists headings, paragraphs, each item and each quote, in order', () => {
    expect(blockOutline(NOTE)).toEqual([
      { kind: 'heading', text: 'Plans', level: 1, at: [0] },
      { kind: 'block', text: 'The summer, roughly.', id: 'p1', type: 'paragraph', at: [1] },
      { kind: 'block', text: 'Tent', id: 'i1', type: 'listItem', at: [2, 0] },
      { kind: 'block', text: 'Pegs', id: 'i2', type: 'listItem', at: [2, 0, 1, 0] },
      { kind: 'block', text: 'Stove', id: null, type: 'listItem', at: [2, 1] },
      { kind: 'heading', text: 'Later', level: 2, at: [3] },
      { kind: 'block', text: 'Said once.', id: 'q1', type: 'blockquote', at: [4] },
      { kind: 'heading', text: 'Other', level: 1, at: [5] },
      { kind: 'block', text: 'Last words.', id: null, type: 'paragraph', at: [6] },
    ]);
  });

  it('passes over empty paragraphs, rules, source it cannot model, cards and embeds', () => {
    const skipped = doc(
      paragraph(''),
      { type: 'horizontalRule' },
      { type: 'rawBlock', attrs: { markdown: '<div>x</div>' } },
      { type: 'bookmark', attrs: { target: 'x' } },
      { type: 'blockEmbed', attrs: { target: 'x', heading: '#^a' } },
      heading(2, '   '),
    );
    expect(blockOutline(skipped)).toEqual([]);
  });

  it('shows a long block cut short, and its words run together', () => {
    const long = 'word '.repeat(60);
    const [entry] = blockOutline(doc(paragraph(`  ${long}\n  end`)));
    expect(entry?.kind).toBe('block');
    expect(entry?.text.length).toBe(BLOCK_PREVIEW_LENGTH);
    expect(entry?.text.endsWith('…')).toBe(true);
    expect(entry?.text).not.toMatch(/\s\s/);
  });

  it('reads a link in a block by its label', () => {
    const withLink: EditorNode = {
      type: 'paragraph',
      content: [
        text('See '),
        { type: 'wikiLink', attrs: { target: 'Rome', heading: null, alias: 'the city' } },
      ],
    };
    expect(blockOutline(doc(withLink))[0]?.text).toBe('See the city');
  });
});

describe('matchingOutline', () => {
  const entries = blockOutline(NOTE);

  it('offers everything, in order, for nothing typed', () => {
    expect(matchingOutline(entries, '')).toEqual(entries);
  });

  it('offers the headings and blocks whose words hold what was typed, regardless of case', () => {
    expect(matchingOutline(entries, ' T').map((entry) => entry.text)).toEqual([
      'The summer, roughly.',
      'Tent',
      'Stove',
      'Later',
      'Other',
      'Last words.',
    ]);
    expect(matchingOutline(entries, 'PEG').map((entry) => entry.text)).toEqual(['Pegs']);
  });

  it('leaves out a heading no link could name, and stops at the limit', () => {
    const odd = doc(heading(1, 'A [draft]'), heading(1, 'C# notes'), paragraph('A [draft] block'));
    expect(matchingOutline(blockOutline(odd), '').map((entry) => entry.text)).toEqual([
      'A [draft] block',
    ]);
    expect(matchingOutline(entries, '', 2)).toHaveLength(2);
  });
});

describe('anchoredBlocks', () => {
  it('lists each block with an id, in order, with a line of what it says', () => {
    expect(anchoredBlocks(NOTE)).toEqual([
      { id: 'p1', text: 'The summer, roughly.' },
      { id: 'i1', text: 'Tent' },
      { id: 'i2', text: 'Pegs' },
      { id: 'q1', text: 'Said once.' },
    ]);
  });

  it('lists an id once, where it is first, and a list’s own id too', () => {
    const twice = doc(paragraph('First', 'a1'), paragraph('Second', 'a1'), {
      ...bullets(item('One')),
      attrs: { anchor: 'l1' },
    });
    expect(anchoredBlocks(twice)).toEqual([
      { id: 'a1', text: 'First' },
      { id: 'l1', text: 'One' },
    ]);
  });
});

describe('locateFragment', () => {
  it('finds a block by its id, however deep', () => {
    expect(locateFragment(NOTE, { kind: 'block', id: 'p1' })).toEqual([1]);
    expect(locateFragment(NOTE, { kind: 'block', id: 'i2' })).toEqual([2, 0, 1, 0]);
    expect(locateFragment(NOTE, { kind: 'block', id: 'q1' })).toEqual([4]);
    expect(nodeAt(NOTE.content[2]!, [0, 1, 0]).attrs).toEqual({ anchor: 'i2' });
  });

  it('finds a heading by its words, then regardless of case', () => {
    expect(locateFragment(NOTE, { kind: 'heading', heading: 'Later' })).toEqual([3]);
    expect(locateFragment(NOTE, { kind: 'heading', heading: 'later' })).toEqual([3]);
    const both = doc(heading(1, 'later'), heading(1, 'Later'));
    expect(locateFragment(both, { kind: 'heading', heading: 'Later' })).toEqual([1]);
  });

  it('is null when the note has no such block or heading', () => {
    expect(locateFragment(NOTE, { kind: 'block', id: 'gone' })).toBeNull();
    expect(locateFragment(NOTE, { kind: 'heading', heading: 'Nowhere' })).toBeNull();
  });
});

describe('fragmentContent', () => {
  it('is the block an id names', () => {
    expect(fragmentContent(NOTE, { kind: 'block', id: 'p1' })).toEqual([NOTE.content[1]]);
  });

  it('is an item in a list of its own, numbered as it was', () => {
    const ordered: EditorNode = {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [item('Third'), item('Fourth', 'o4')],
    };
    expect(fragmentContent(doc(ordered), { kind: 'block', id: 'o4' })).toEqual([
      { type: 'orderedList', attrs: { start: 4 }, content: [item('Fourth', 'o4')] },
    ]);
    expect(fragmentContent(NOTE, { kind: 'block', id: 'i2' })).toEqual([
      { type: 'bulletList', content: [item('Pegs', 'i2')] },
    ]);
  });

  it('is a heading and what is under it, to the next heading as high', () => {
    expect(fragmentContent(NOTE, { kind: 'heading', heading: 'Plans' })).toEqual(
      NOTE.content.slice(0, 5),
    );
    expect(fragmentContent(NOTE, { kind: 'heading', heading: 'Later' })).toEqual(
      NOTE.content.slice(3, 5),
    );
    expect(fragmentContent(NOTE, { kind: 'heading', heading: 'Other' })).toEqual(
      NOTE.content.slice(5),
    );
  });

  it('is null for a block the note does not have', () => {
    expect(fragmentContent(NOTE, { kind: 'block', id: 'gone' })).toBeNull();
  });
});
