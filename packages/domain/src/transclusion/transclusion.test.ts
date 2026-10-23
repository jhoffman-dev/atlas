import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { nestedBlockOf } from '../bookmarks/bookmark-switch.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  BLOCK_EMBED_NODE,
  blockEmbedNode,
  isTransclusion,
  paragraphOfEmbed,
} from './block-embed.ts';
import { missingTransclusion, transclusionOf } from './transclusion-card.ts';

const linkOf = (source: string) => {
  const link = readWikiLink(source);
  if (link === null) throw new Error(`not a link: ${source}`);
  return link;
};

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const embed = blockEmbedNode({ target: 'A', heading: '#^a1', alias: null });

const SOURCE: EditorDocument = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Plans')] },
    { type: 'paragraph', attrs: { anchor: 'p1' }, content: [text('The summer.')] },
    {
      type: 'blockquote',
      attrs: { anchor: 'q1' },
      content: [{ type: 'paragraph', content: [text('Quoted.')] }, embed],
    },
  ],
};

describe('isTransclusion', () => {
  it('is an embed that names a block or a heading', () => {
    expect(isTransclusion(linkOf('![[Plans#^p1]]'))).toBe(true);
    expect(isTransclusion(linkOf('![[Plans#Packing]]'))).toBe(true);
    expect(isTransclusion(linkOf('![[#^p1]]'))).toBe(true);
  });

  it('is not a link, nor an embed of a whole note', () => {
    expect(isTransclusion(linkOf('[[Plans#^p1]]'))).toBe(false);
    expect(isTransclusion(linkOf('![[Plans]]'))).toBe(false);
    expect(isTransclusion(linkOf('![[Plans#]]'))).toBe(false);
  });
});

describe('the embed node', () => {
  it('holds the link, and is written as its embed alone in a paragraph', () => {
    expect(embed).toEqual({
      type: BLOCK_EMBED_NODE,
      attrs: { target: 'A', heading: '#^a1', alias: null },
    });
    expect(paragraphOfEmbed(embed)).toEqual({
      type: 'paragraph',
      content: [
        {
          type: 'wikiLink',
          attrs: { target: 'A', heading: '#^a1', alias: null, embed: true },
        },
      ],
    });
    expect(paragraphOfEmbed({ type: 'paragraph' })).toBeNull();
  });

  it('becomes its link inside another block, as a bookmark does', () => {
    expect(nestedBlockOf(embed)).toEqual(paragraphOfEmbed(embed));
  });
});

describe('transclusionOf', () => {
  const path = 'Trips/Plans.md' as VaultPath;

  it('shows the block a link names, with its note’s title', () => {
    expect(
      transclusionOf({ link: linkOf('![[Plans#^p1]]'), path, properties: {}, doc: SOURCE }),
    ).toEqual({
      kind: 'block',
      path,
      title: 'Plans',
      archived: false,
      fragment: { kind: 'block', id: 'p1' },
      content: { type: 'doc', content: [SOURCE.content[1]] },
      highlight: null,
    });
  });

  describe("a literature note's highlight (#506)", () => {
    const literature = {
      source: {
        kind: 'pdf' as const,
        title: 'Summer reading',
        author: null,
        file: 'Trips/r.pdf' as VaultPath,
      },
      highlights: [
        {
          id: 'q1',
          quote: 'Quoted.',
          comment: '',
          style: { mark: 'highlight' as const, color: 'yellow' as const },
          anchor: {
            kind: 'pdf' as const,
            page: 7,
            quote: null,
            rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
          start: 0,
          markerEnd: 0,
          quoteEnd: 0,
          end: 0,
        },
      ],
    };
    const shown = (source: string) =>
      transclusionOf({ link: linkOf(source), path, properties: {}, doc: SOURCE, literature });

    it('wears a chip naming its source and page', () => {
      const card = shown('![[Plans#^q1]]');
      expect(card.kind === 'block' ? card.highlight : 'not shown').toEqual({
        kind: 'pdf',
        hue: 'red',
        title: 'Summer reading',
        place: 'p. 7',
        opensInReader: true,
      });
    });

    it('wears none for a block of the note that is not a highlight, nor for a heading', () => {
      const block = shown('![[Plans#^p1]]');
      expect(block.kind === 'block' ? block.highlight : 'not shown').toBeNull();
      const heading = shown('![[Plans#Plans]]');
      expect(heading.kind === 'block' ? heading.highlight : 'not shown').toBeNull();
    });
  });

  it('draws an embed inside the block as its link: a cycle stops at one level', () => {
    const shown = transclusionOf({
      link: linkOf('![[Plans#^q1]]'),
      path,
      properties: {},
      doc: SOURCE,
    });
    expect(shown.kind).toBe('block');
    const quote = shown.kind === 'block' ? shown.content.content[0] : undefined;
    expect(quote?.content?.[1]).toEqual(paragraphOfEmbed(embed));
    expect(JSON.stringify(shown)).not.toContain(BLOCK_EMBED_NODE);
  });

  it('says the block is missing when the note has no such id or heading', () => {
    expect(
      transclusionOf({ link: linkOf('![[Plans#^gone]]'), path, properties: {}, doc: SOURCE }),
    ).toEqual({
      kind: 'missing-block',
      path,
      title: 'Plans',
      archived: false,
      fragment: { kind: 'block', id: 'gone' },
    });
  });

  it('names the note by its title property, and says when it is archived', () => {
    const archived = 'Archive/Plans.md' as VaultPath;
    const shown = transclusionOf({
      link: linkOf('![[Plans#Plans]]'),
      path: archived,
      properties: { title: 'Summer plans' },
      doc: SOURCE,
    });
    expect(shown).toMatchObject({ kind: 'block', title: 'Summer plans', archived: true });
  });

  it('labels a missing note by the name its link gives', () => {
    expect(missingTransclusion(linkOf('![[Gone#^p1]]'))).toEqual({
      kind: 'missing-note',
      label: 'Gone',
    });
  });
});
