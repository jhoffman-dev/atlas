import { describe, expect, it } from 'vitest';
import { bookmarkNode } from '../bookmarks/bookmark.ts';
import type { EditorDocument, EditorMark, EditorNode } from '../markdown/editor-node.ts';
import { formatWikiLink, type WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import { blockEmbedNode } from '../transclusion/block-embed.ts';
import { missingTransclusion, type Transclusion } from '../transclusion/transclusion-card.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { exportForConfluence, linkTargetsOf, shownBlocksOf, type ExportSources } from './index.ts';

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
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });
const raw = (markdown: string): EditorNode => ({ type: 'rawBlock', attrs: { markdown } });

const TITLES: Record<string, string> = { 'mara quill': 'Mara Quill', Plans: 'Summer plans' };

const sources = (shown: Record<string, Transclusion> = {}): ExportSources => ({
  titleOf: (target) => TITLES[target] ?? null,
  shown: (wanted) => shown[formatWikiLink(wanted)] ?? missingTransclusion(wanted),
});

const exported = (
  document: EditorDocument,
  {
    shown = {},
    propertyKeys = [],
  }: { shown?: Record<string, Transclusion>; propertyKeys?: string[] } = {},
) =>
  exportForConfluence({
    doc: document,
    title: 'Weekly sync',
    propertyKeys,
    sources: sources(shown),
  });

const blocksOf = (document: EditorDocument, options?: Parameters<typeof exported>[1]) =>
  exported(document, options).doc.content;

const embedOf = (target: string, heading: string): WikiLinkOrEmbed => ({
  target,
  heading,
  alias: null,
  embed: true,
});

const shownBlock = (content: EditorNode[]): Transclusion => ({
  kind: 'block',
  path: 'Plans.md' as VaultPath,
  title: 'Summer plans',
  archived: false,
  fragment: { kind: 'block', id: 'p1' },
  content: doc(...content),
});

describe('a wiki link', () => {
  it('is shared as the title of the note it names', () => {
    expect(blocksOf(doc(paragraph(text('Ask '), link('mara quill'), text('.'))))).toEqual([
      paragraph(text('Ask '), text('Mara Quill'), text('.')),
    ]);
  });

  it('is its alias when it has one, and its target as written when it names no note', () => {
    expect(
      blocksOf(doc(paragraph(link('mara quill', { alias: 'Mara' }), link('Tobias Fenn')))),
    ).toEqual([paragraph(text('Mara'), text('Tobias Fenn'))]);
  });

  it('names the heading it points at after the title, and no block id', () => {
    expect(
      blocksOf(
        doc(paragraph(link('Plans', { heading: '#Packing' }), link('Plans', { heading: '#^p1' }))),
      ),
    ).toEqual([paragraph(text('Summer plans › Packing'), text('Summer plans'))]);
  });

  it('to a heading of its own note is the heading; to a block of it, the note', () => {
    expect(
      blocksOf(doc(paragraph(link('', { heading: '#Decisions' }), link('', { heading: '#^d1' })))),
    ).toEqual([paragraph(text('Decisions'), text('Weekly sync'))]);
  });

  it('keeps the look it had', () => {
    const bold = [{ type: 'bold' }];
    expect(blocksOf(doc(paragraph({ ...link('Plans'), marks: bold })))).toEqual([
      paragraph(text('Summer plans', bold)),
    ]);
  });

  it('says where each went, once, in note order', () => {
    const { dropped } = exported(
      doc(paragraph(link('Plans'), link('mara quill', { alias: 'Mara' }), link('Plans'))),
    );
    expect(dropped).toEqual([{ kind: 'link', items: ['[[Plans]]', '[[mara quill|Mara]]'] }]);
  });

  it('shown in a sentence, `![[x]]`, is named, and listed as an embed', () => {
    const { doc: page, dropped } = exported(
      doc(paragraph(text('See '), link('diagram.png', { embed: true }))),
    );
    expect(page.content).toEqual([paragraph(text('See '), text('diagram.png'))]);
    expect(dropped).toEqual([{ kind: 'embed', items: ['![[diagram.png]]'] }]);
  });

  it('as a bookmark card is a paragraph of its words', () => {
    const { doc: page, dropped } = exported(
      doc(bookmarkNode({ target: 'Plans', heading: null, alias: null })),
    );
    expect(page.content).toEqual([paragraph(text('Summer plans'))]);
    expect(dropped).toEqual([{ kind: 'link', items: ['[[Plans]]'] }]);
  });
});

describe('a block shown in place', () => {
  const embed = blockEmbedNode({ target: 'Plans', heading: '#^p1', alias: null });

  it('is the block it shows, quoted, under the note it came from', () => {
    const shown = { '![[Plans#^p1]]': shownBlock([paragraph(text('Pack light.'))]) };
    expect(blocksOf(doc(embed), { shown })).toEqual([
      {
        type: 'blockquote',
        content: [
          paragraph(text('From Summer plans', [{ type: 'italic' }])),
          paragraph(text('Pack light.')),
        ],
      },
    ]);
  });

  it('is exported as the rest of the note is: its links as words, its ids gone', () => {
    const block = {
      type: 'bulletList',
      content: [{ type: 'listItem', attrs: { anchor: 'p1' }, content: [paragraph(link('Plans'))] }],
    };
    const shown = { '![[Plans#^p1]]': shownBlock([block]) };
    const { doc: page, dropped } = exported(doc(embed), { shown });
    expect(page.content[0]?.content?.[1]).toEqual({
      type: 'bulletList',
      content: [{ type: 'listItem', attrs: {}, content: [paragraph(text('Summer plans'))] }],
    });
    expect(dropped).toEqual([
      { kind: 'link', items: ['[[Plans]]'] },
      { kind: 'block-id', items: ['p1'] },
    ]);
  });

  it('holding markdown the editor does not model follows its note unquoted', () => {
    const shown = { '![[Plans#^p1]]': shownBlock([raw('Pack light.[^1]')]) };
    expect(blocksOf(doc(embed), { shown })).toEqual([
      paragraph(text('From Summer plans', [{ type: 'italic' }])),
      raw('Pack light.[^1]'),
    ]);
  });

  it('that is not there says so, and is listed as missing', () => {
    const { doc: page, dropped } = exported(doc(embed));
    expect(page.content).toEqual([paragraph(text('[Not found: Summer plans]'))]);
    expect(dropped).toEqual([{ kind: 'missing-embed', items: ['![[Plans#^p1]]'] }]);
  });

  it('is found by its link, as the note writes it', () => {
    expect(shownBlocksOf(doc(paragraph(text('x')), embed))).toEqual([embedOf('Plans', '#^p1')]);
  });
});

describe('a callout', () => {
  const callout = (attrs: Record<string, unknown>, ...content: EditorNode[]): EditorNode => ({
    type: 'callout',
    attrs: { kind: 'warning', title: null, fold: null, ...attrs },
    content,
  });
  const bold = (value: string) => text(value, [{ type: 'bold' }]);

  it('is a quote that opens with its name in bold', () => {
    expect(blocksOf(doc(callout({}, paragraph(text('Mind the gap.')))))).toEqual([
      {
        type: 'blockquote',
        content: [paragraph(bold('Warning')), paragraph(text('Mind the gap.'))],
      },
    ]);
  });

  it('with a title opens with its name and then the title, its links as words', () => {
    expect(
      blocksOf(doc(callout({ title: 'Ask [[mara quill]]' }, paragraph(text('Soon.'))))),
    ).toEqual([
      {
        type: 'blockquote',
        content: [paragraph(bold('Warning:'), text(' Ask Mara Quill')), paragraph(text('Soon.'))],
      },
    ]);
  });

  it('with no body has only its opening line', () => {
    expect(blocksOf(doc(callout({ title: 'Done' }, { type: 'paragraph' })))).toEqual([
      { type: 'blockquote', content: [paragraph(bold('Warning:'), text(' Done'))] },
    ]);
  });

  it('lists its fold, which a quote cannot keep', () => {
    expect(exported(doc(callout({ kind: 'faq', fold: '-' }))).dropped).toEqual([
      { kind: 'callout-fold', items: ['[!faq]-'] },
    ]);
  });

  it('inside a quote is converted too', () => {
    const quote = { type: 'blockquote', content: [callout({ kind: 'tip' })] };
    expect(blocksOf(doc(quote))).toEqual([
      {
        type: 'blockquote',
        content: [{ type: 'blockquote', content: [paragraph(bold('Tip'))] }],
      },
    ]);
  });
});

describe('what the page cannot reach', () => {
  const image = (src: string, alt: string | null = null): EditorNode => ({
    type: 'image',
    attrs: { src, alt, title: null },
  });

  it('keeps an image on the web, and names one in the vault by its words', () => {
    const { doc: page, dropped } = exported(
      doc(
        paragraph(
          image('https://example.com/map.png', 'Map'),
          image('attachments/plan.png', 'The plan'),
          image('attachments/bare.png'),
        ),
      ),
    );
    expect(page.content).toEqual([
      paragraph(
        image('https://example.com/map.png', 'Map'),
        text('[Image: The plan]'),
        text('[Image: attachments/bare.png]'),
      ),
    ]);
    expect(dropped).toEqual([
      { kind: 'image', items: ['attachments/plan.png', 'attachments/bare.png'] },
    ]);
  });

  it('keeps a link to the web or an email, and only the words of one to a file', () => {
    const linked = (href: string) => text(href, [{ type: 'link', attrs: { href, title: null } }]);
    const { doc: page, dropped } = exported(
      doc(
        paragraph(
          linked('https://example.com'),
          linked('mailto:mara@example.com'),
          linked('Notes/Plans.md'),
        ),
      ),
    );
    expect(page.content).toEqual([
      paragraph(
        linked('https://example.com'),
        linked('mailto:mara@example.com'),
        text('Notes/Plans.md'),
      ),
    ]);
    expect(dropped).toEqual([{ kind: 'link', items: ['Notes/Plans.md'] }]);
  });

  it('leaves out block ids, wherever they are, and lists them', () => {
    const { doc: page, dropped } = exported(
      doc(
        { type: 'paragraph', attrs: { anchor: 'a1' }, content: [text('One.')] },
        { type: 'table', attrs: { anchor: 't1', align: null }, content: [] },
      ),
    );
    expect(page.content).toEqual([
      { type: 'paragraph', attrs: {}, content: [text('One.')] },
      { type: 'table', attrs: { align: null }, content: [] },
    ]);
    expect(dropped).toEqual([{ kind: 'block-id', items: ['a1', 't1'] }]);
  });

  it('leaves out the properties, and lists their keys in order', () => {
    expect(exported(doc(), { propertyKeys: ['type', 'status'] }).dropped).toEqual([
      { kind: 'property', items: ['type', 'status'] },
    ]);
  });

  it('lists every kind it dropped in one fixed order', () => {
    const { dropped } = exported(
      doc(
        { type: 'paragraph', attrs: { anchor: 'a1' }, content: [link('Plans')] },
        raw('<!-- draft -->'),
      ),
      { propertyKeys: ['type'] },
    );
    expect(dropped.map((drop) => drop.kind)).toEqual(['property', 'link', 'block-id', 'comment']);
  });
});

describe('what the page can hold', () => {
  it('is kept as it is: headings, tasks, tables, code, rules and breaks', () => {
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [paragraph(text('Book'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [paragraph(text('Pack'))] },
        ],
      },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('[[not a link]]')] },
      { type: 'horizontalRule' },
      paragraph(text('a'), { type: 'hardBreak' }, text('b', [{ type: 'code' }])),
    ];
    const { doc: page, dropped } = exported(doc(...blocks));
    expect(page.content).toEqual(blocks);
    expect(dropped).toEqual([]);
  });

  it('in markdown the editor does not model, has its links and comments rewritten', () => {
    const { doc: page, dropped } = exported(doc(raw('Ask [[mara quill]].[^1] <!-- later -->')));
    expect(page.content).toEqual([raw('Ask Mara Quill.[^1] ')]);
    expect(dropped).toEqual([
      { kind: 'link', items: ['[[mara quill]]'] },
      { kind: 'comment', items: ['<!-- later -->'] },
    ]);
  });
});

describe('linkTargetsOf', () => {
  it('is every target the export will ask a title for, once, wherever its link is', () => {
    const callout = {
      type: 'callout',
      attrs: { kind: 'note', title: '[[Tobias Fenn]]', fold: null },
      content: [paragraph(link('Plans'))],
    };
    const targets = linkTargetsOf([
      doc(
        paragraph(link('mara quill'), link('', { heading: '#Plans' })),
        bookmarkNode({ target: 'Larkspur Payroll', heading: null, alias: null }),
        raw('A [[Ledger]].[^1]'),
        callout,
        blockEmbedNode({ target: 'Plans', heading: '#^p1', alias: null }),
      ),
      doc(paragraph(link('Mara Quill'))),
    ]);
    expect(targets).toEqual([
      'mara quill',
      'Larkspur Payroll',
      'Ledger',
      'Tobias Fenn',
      'Plans',
      'Mara Quill',
    ]);
  });

  it('asks nothing of a link that has an alias', () => {
    expect(linkTargetsOf([doc(paragraph(link('Plans', { alias: 'it' })))])).toEqual([]);
  });
});
