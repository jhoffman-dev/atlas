import { describe, expect, it } from 'vitest';
import { blockIdAtEnd } from './block-anchor.ts';
import {
  anchoredBlocks,
  anchorPlaces,
  anchorStyleOf,
  blockOutline,
  isAnchorPlace,
  locateFragment,
  offeredByOwnId,
  withAnchorsAtPlaces,
  type OutlineEntry,
} from './block-outline.ts';
import type { EditorDocument, EditorNode } from './editor-node.ts';

/*
 * A26-01, the review of Phase 26: an id follows its block whatever kind the
 * block becomes, a heading holds one as Obsidian writes it, an id the file
 * has no place for is never let go without a trace, and the picker never
 * offers a block by an id that names another.
 */

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string, anchor?: string): EditorNode => ({
  type: 'paragraph',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [text(value)],
});
const heading = (value: string, anchor?: string): EditorNode => ({
  type: 'heading',
  attrs: { level: 2, ...(anchor !== undefined && { anchor }) },
  content: [text(value)],
});
const item = (first: EditorNode, anchor?: string): EditorNode => ({
  type: 'listItem',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [first],
});
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

/** The words a node holds, run together. */
const words = (node: EditorNode): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(words).join('');

describe('blockIdAtEnd, on a line of a note saved on Windows', () => {
  it('reads the id before the carriage return', () => {
    expect(blockIdAtEnd('Pack the tent ^f3k9x2\r')?.id).toBe('f3k9x2');
  });
});

describe('a heading holds an id after its words, as Obsidian writes it', () => {
  it('is a place for one, written after its text', () => {
    expect(anchorStyleOf(heading('Plans'))).toBe('inline');
    expect(anchorPlaces(heading('Plans'))).toEqual([[]]);
    expect(anchorStyleOf({ type: 'heading', attrs: { level: 1 } })).toBeNull();
  });

  it('is found by its id, and kept in the index', () => {
    const note = doc(paragraph('Lead'), heading('Plans', 'h1'));
    expect(locateFragment(note, { kind: 'block', id: 'h1' })).toEqual([1]);
    expect(anchoredBlocks(note)).toEqual([{ id: 'h1', text: 'Plans' }]);
  });
});

describe('isAnchorPlace: one rule with anchorPlaces', () => {
  it('says of each node, by the kinds of block around it, what anchorPlaces lists', () => {
    const list: EditorNode = {
      type: 'bulletList',
      content: [
        item(paragraph('One')),
        {
          type: 'listItem',
          content: [paragraph('Two'), { type: 'bulletList', content: [item(paragraph('Nested'))] }],
        },
      ],
    };
    const quote: EditorNode = {
      type: 'blockquote',
      content: [paragraph('Said'), { type: 'bulletList', content: [item(paragraph('In'))] }],
    };
    const table: EditorNode = {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('c')] }] }],
    };
    for (const block of [paragraph('P'), heading('H'), list, quote, table]) {
      const listed = anchorPlaces(block).map((path) => JSON.stringify(path));
      const said: string[] = [];
      const visit = (node: EditorNode, path: number[], ancestors: string[]) => {
        if (isAnchorPlace(node, ancestors)) said.push(JSON.stringify(path));
        (node.content ?? []).forEach((child, index) =>
          visit(child, [...path, index], [...ancestors, node.type]),
        );
      };
      visit(block, [], []);
      expect(said.sort(), block.type).toEqual([...listed].sort());
    }
  });
});

describe('withAnchorsAtPlaces: an id follows its block into the block that holds it', () => {
  it('moves an id on an item’s first paragraph to the item', () => {
    const list: EditorNode = {
      type: 'bulletList',
      content: [item(paragraph('Pack the tent', 'a1'))],
    };
    const placed = withAnchorsAtPlaces(list);
    expect(placed.content?.[0]?.attrs?.['anchor']).toBe('a1');
    expect(placed.content?.[0]?.content?.[0]?.attrs?.['anchor'] ?? null).toBeNull();
  });

  it('moves an id on a quoted paragraph to the quote', () => {
    const quote: EditorNode = { type: 'blockquote', content: [paragraph('Said once', 'q1')] };
    expect(withAnchorsAtPlaces(quote).attrs?.['anchor']).toBe('q1');
  });

  it('keeps an id whose block already holds another as words, rather than letting it go', () => {
    const quote: EditorNode = {
      type: 'blockquote',
      content: [paragraph('One', 'a1'), paragraph('Two', 'b2')],
    };
    const placed = withAnchorsAtPlaces(quote);
    expect(placed.attrs?.['anchor']).toBe('a1');
    expect(words(placed.content?.[1] as EditorNode)).toBe('Two ^b2');
  });

  it('lets a copy of the id its block already holds go, with nothing left behind', () => {
    const list: EditorNode = {
      type: 'bulletList',
      content: [item(paragraph('Pack', 'a1'), 'a1')],
    };
    const placed = withAnchorsAtPlaces(list);
    expect(placed.content?.[0]?.attrs?.['anchor']).toBe('a1');
    expect(words(placed)).toBe('Pack');
  });
});

describe('the picker offers a block by an id only when that id is its own', () => {
  it('offers the later holders of a repeated id with none, so picking one asks its note', () => {
    const note = doc(paragraph('First', 'dup'), paragraph('Second', 'dup'));
    const ids = blockOutline(note).map((entry) => (entry.kind === 'block' ? entry.id : null));
    expect(ids).toEqual(['dup', null]);
  });

  it('withholds an id two offered blocks share, whoever read them', () => {
    const entries: OutlineEntry[] = [
      { kind: 'block', text: 'One', id: 'dup', type: 'paragraph', at: [0] },
      { kind: 'block', text: 'Two', id: 'dup', type: 'paragraph', at: [1] },
      { kind: 'block', text: 'Three', id: 'own', type: 'paragraph', at: [2] },
    ];
    expect(
      offeredByOwnId(entries).map((entry) => (entry.kind === 'block' ? entry.id : null)),
    ).toEqual([null, null, 'own']);
  });
});
