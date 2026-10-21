import { describe, expect, it } from 'vitest';
import { bookmarkNode } from '../bookmarks/bookmark.ts';
import { BLOCK_ANCHOR_ATTR } from '../markdown/block-anchor.ts';
import type { EditorDocument, EditorMark, EditorNode } from '../markdown/editor-node.ts';
import { blockEmbedNode } from '../transclusion/block-embed.ts';
import { missingTransclusion, type Transclusion } from '../transclusion/transclusion-card.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  embeddedNotesOf,
  exportImageSourcesOf,
  exportStandalone,
  type StandaloneSources,
} from './index.ts';

const text = (value: string, marks?: EditorMark[]): EditorNode => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});
const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const link = (target: string, more: Record<string, unknown> = {}): EditorNode => ({
  type: 'wikiLink',
  attrs: { target, heading: null, alias: null, ...more },
});
const embed = (target: string) => link(target, { embed: true });
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });
const image = (src: string, alt = 'Plan'): EditorNode => ({
  type: 'image',
  attrs: { src, alt, title: null },
});

const TITLES: Record<string, string> = { Kickoff: 'Kickoff with Larkspur', Plans: 'Summer plans' };

function sources(overrides: Partial<StandaloneSources> = {}): StandaloneSources {
  return {
    titleOf: (target) => TITLES[target] ?? null,
    shown: missingTransclusion,
    readRaw: () => [],
    hrefOf: (target) => (target === 'Kickoff' ? 'Kickoff%20with%20Larkspur.md' : null),
    imageSrc: (src) => (src.includes('missing') ? null : `Notes%20attachments/${src}`),
    embedded: () => null,
    ...overrides,
  };
}

const exported = (body: EditorDocument, given?: Partial<StandaloneSources>) =>
  exportStandalone({ doc: body, title: 'Notes', sources: sources(given) });

describe('exportStandalone (#501)', () => {
  it('links a note exported beside it by its file, keeping the link’s look', () => {
    const bold: EditorMark = { type: 'bold' };
    const result = exported(doc(paragraph(text('See '), { ...link('Kickoff'), marks: [bold] })));
    expect(result.doc.content[0]?.content?.[1]).toEqual(
      text('Kickoff with Larkspur', [
        bold,
        { type: 'link', attrs: { href: 'Kickoff%20with%20Larkspur.md', title: null } },
      ]),
    );
    expect(result.dropped).toEqual([]);
  });

  it('makes a link to a note not exported its words, and names it as left out', () => {
    const result = exported(doc(paragraph(link('Plans', { alias: 'the plans' }))));
    expect(result.doc.content[0]?.content).toEqual([text('the plans')]);
    expect(result.dropped).toEqual([{ kind: 'link', items: ['[[Plans|the plans]]'] }]);
  });

  it('keeps a link’s heading in its words', () => {
    const result = exported(doc(paragraph(link('Plans', { heading: '#June' }))));
    expect(result.doc.content[0]?.content).toEqual([text('Summer plans › June')]);
  });

  it('copies a picture in the vault, and leaves one on the web where it is', () => {
    const result = exported(
      doc(paragraph(image('attachments/plan.png')), paragraph(image('https://example.com/a.png'))),
    );
    expect(result.doc.content[0]?.content?.[0]?.attrs?.['src']).toBe(
      'Notes%20attachments/attachments/plan.png',
    );
    expect(result.doc.content[1]?.content?.[0]?.attrs?.['src']).toBe('https://example.com/a.png');
  });

  it('names a picture it could not copy instead of linking a file that is not there', () => {
    const result = exported(doc(paragraph(image('missing.png', 'Chart'))));
    expect(result.doc.content[0]?.content).toEqual([text('[Image: Chart]')]);
    expect(result.dropped).toEqual([{ kind: 'image', items: ['missing.png'] }]);
  });

  it('draws an embedded picture as the picture, its alias as its words', () => {
    const result = exported(
      doc(paragraph(text('Here: '), link('plan.png', { embed: true, alias: 'Q3' }))),
    );
    expect(result.doc.content[0]?.content?.[1]).toEqual({
      type: 'image',
      attrs: { src: 'Notes%20attachments/plan.png', alt: 'Q3', title: null },
    });
  });

  it('quotes a whole note embedded alone in a paragraph, under its title', () => {
    const embedded = { title: 'Summer plans', doc: doc(paragraph(text('Go north.'))) };
    const result = exported(doc(paragraph(embed('Plans'))), { embedded: () => embedded });
    expect(result.doc.content).toEqual([
      {
        type: 'blockquote',
        content: [
          paragraph(text('From Summer plans', [{ type: 'italic' }])),
          paragraph(text('Go north.')),
        ],
      },
    ]);
  });

  it('opens one level of embeds: a note embedding the first one back is its words there', () => {
    const asked: string[] = [];
    const back = { title: 'Summer plans', doc: doc(paragraph(embed('Notes'))) };
    const result = exported(doc(paragraph(embed('Plans'))), {
      embedded: (wanted) => {
        asked.push(wanted.target);
        return back;
      },
    });
    expect(asked).toEqual(['Plans']);
    const quote = result.doc.content[0]?.content ?? [];
    expect(quote[1]).toEqual(paragraph(text('Notes')));
  });

  it('leaves an embed in a sentence as its words', () => {
    const result = exported(doc(paragraph(text('As '), embed('Plans'), text(' says'))), {
      embedded: () => ({ title: 'Summer plans', doc: doc() }),
    });
    expect(result.doc.content[0]?.content).toEqual([
      text('As '),
      text('Summer plans'),
      text(' says'),
    ]);
  });

  it('quotes a shown block from its note, and says when it is not found', () => {
    const shown: Transclusion = {
      kind: 'block',
      path: 'Plans.md' as VaultPath,
      title: 'Summer plans',
      archived: false,
      fragment: { kind: 'block', id: 'abc123' },
      content: doc(paragraph(text('Book the train.'))),
    };
    const found = exported(
      doc(blockEmbedNode({ target: 'Plans', heading: '#^abc123', alias: null })),
      {
        shown: () => shown,
      },
    );
    expect(found.doc.content[0]?.type).toBe('blockquote');
    const missing = exported(doc(blockEmbedNode({ target: 'Gone', heading: '#^x1', alias: null })));
    expect(missing.doc.content).toEqual([paragraph(text('[Not found: Gone]'))]);
  });

  it('keeps a callout a callout, and a markdown link as written', () => {
    const callout: EditorNode = {
      type: 'callout',
      attrs: { kind: 'warning', title: null, fold: null },
      content: [paragraph(text('docs', [{ type: 'link', attrs: { href: 'Other.md' } }]))],
    };
    expect(exported(doc(callout)).doc.content).toEqual([callout]);
  });

  it('writes a bookmark as its link', () => {
    const result = exported(doc(bookmarkNode({ target: 'Kickoff', heading: null, alias: null })));
    expect(result.doc.content[0]?.content?.[0]?.marks?.[0]?.type).toBe('link');
  });

  it('drops block ids, naming them', () => {
    const anchored = { ...paragraph(text('Turn.')), attrs: { [BLOCK_ANCHOR_ATTR]: 't0001' } };
    const result = exported(doc(anchored));
    expect(result.doc.content[0]).toEqual({
      type: 'paragraph',
      attrs: {},
      content: [text('Turn.')],
    });
    expect(result.dropped).toEqual([{ kind: 'block-id', items: ['t0001'] }]);
  });
});

describe('embeddedNotesOf', () => {
  it('lists each whole note embedded alone in a paragraph, at any depth, and nothing else', () => {
    const quoted: EditorNode = { type: 'blockquote', content: [paragraph(embed('Inner'))] };
    const body = doc(
      paragraph(embed('Plans')),
      paragraph(embed('plan.png')),
      paragraph(link('Plans', { embed: true, heading: '#^abc123' })),
      paragraph(text('in '), embed('Sentence')),
      paragraph(link('NotEmbed')),
      quoted,
    );
    expect(embeddedNotesOf(body).map((found) => found.target)).toEqual(['Plans', 'Inner']);
  });
});

describe('exportImageSourcesOf', () => {
  it('lists each picture in the vault once, from images and embeds, across documents', () => {
    const first = doc(
      paragraph(image('a.png'), image('https://example.com/b.png'), embed('c.jpg')),
    );
    const second = doc(paragraph(image('a.png'), embed('Plans')));
    expect(exportImageSourcesOf([first, second])).toEqual(['a.png', 'c.jpg']);
  });
});
