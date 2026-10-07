import { describe, expect, it } from 'vitest';
import type { EditorNode } from '../markdown/editor-node.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { isTransclusion, shownBlockLink } from './block-embed.ts';

/*
 * A26-01: only a note's block is shown in place — `![[Paper.pdf#page=3]]`
 * is a file's page, and stays the link it is — and the rule for when an
 * embed stands as a block of its own is one rule, the reader's and the
 * editor's alike.
 */

const linkOf = (source: string) => {
  const link = readWikiLink(source);
  if (link === null) throw new Error(`not a link: ${source}`);
  return link;
};

const embedNode = (target: string, heading: string | null, embed = true): EditorNode => ({
  type: 'wikiLink',
  attrs: { target, heading, alias: null, embed },
});
const paragraphOf = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const text = (value: string): EditorNode => ({ type: 'text', text: value });

describe('isTransclusion names notes only', () => {
  it('leaves an embed of a file that is not a note a link', () => {
    expect(isTransclusion(linkOf('![[Paper.pdf#page=3]]'))).toBe(false);
    expect(isTransclusion(linkOf('![[photo.PNG#^a1]]'))).toBe(false);
    expect(isTransclusion(linkOf('![[Board.canvas#Plans]]'))).toBe(false);
  });

  it('shows a block of a note, named with its extension or without, dots and all', () => {
    expect(isTransclusion(linkOf('![[Plans.md#^a1]]'))).toBe(true);
    expect(isTransclusion(linkOf('![[Meeting 2026.09.27#^a1]]'))).toBe(true);
    expect(isTransclusion(linkOf('![[Mr. Smith#Notes]]'))).toBe(true);
  });
});

describe('shownBlockLink: an embed alone in one of the note’s own paragraphs', () => {
  it('is null for an embed in bold or italic, which is words with a look', () => {
    const bold: EditorNode = { ...embedNode('Plans', '#^a1'), marks: [{ type: 'bold' }] };
    expect(shownBlockLink(paragraphOf(bold), { topLevel: true })).toBeNull();
  });

  it('is the embed’s link, spaces around it or not', () => {
    const link = { target: 'Plans', heading: '#^a1', alias: null, embed: true };
    expect(shownBlockLink(paragraphOf(embedNode('Plans', '#^a1')), { topLevel: true })).toEqual(
      link,
    );
    expect(
      shownBlockLink(paragraphOf(text('  '), embedNode('Plans', '#^a1'), text(' ')), {
        topLevel: true,
      }),
    ).toEqual(link);
  });

  it('is null inside another block, beside words, as a plain link, or of a whole note', () => {
    const alone = paragraphOf(embedNode('Plans', '#^a1'));
    expect(shownBlockLink(alone, { topLevel: false })).toBeNull();
    expect(
      shownBlockLink(paragraphOf(text('See '), embedNode('Plans', '#^a1')), { topLevel: true }),
    ).toBeNull();
    expect(
      shownBlockLink(paragraphOf(embedNode('Plans', '#^a1', false)), { topLevel: true }),
    ).toBeNull();
    expect(shownBlockLink(paragraphOf(embedNode('Plans', null)), { topLevel: true })).toBeNull();
    expect(
      shownBlockLink(paragraphOf(embedNode('Paper.pdf', '#page=3')), { topLevel: true }),
    ).toBeNull();
    expect(
      shownBlockLink(
        { type: 'heading', content: [embedNode('Plans', '#^a1')] },
        { topLevel: true },
      ),
    ).toBeNull();
  });
});
