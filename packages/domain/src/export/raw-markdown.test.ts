import { describe, expect, it } from 'vitest';
import type { WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import { DroppedContent } from './export-drops.ts';
import {
  escapedForMarkdown,
  rawMarkdownForExport,
  unlinkable,
  type RawExport,
} from './raw-markdown.ts';
import type { RawPart } from './raw-parts.ts';

const wordsOf = (link: WikiLinkOrEmbed) => link.alias ?? link.target.toUpperCase();

/** Each part found where `piece` is in `markdown`, as the markdown reader would give it. */
const at = (markdown: string, piece: string, from = 0) => {
  const start = markdown.indexOf(piece, from);
  if (start === -1) throw new Error(`no ${piece} in ${markdown}`);
  return { start, end: start + piece.length };
};

const exported = (
  markdown: string,
  parts: RawPart[],
  context: Partial<Omit<RawExport, 'dropped'>> = {},
) => {
  const dropped = new DroppedContent();
  const written = rawMarkdownForExport(markdown, parts, {
    wordsOf,
    footnoteLabel: (label) => label,
    escapeStrayFootnotes: false,
    reread: () => [],
    ...context,
    dropped,
  });
  return { markdown: written, dropped: dropped.list() };
};

const wikiLink = (markdown: string, piece: string, link: Partial<WikiLinkOrEmbed>): RawPart => ({
  ...at(markdown, piece),
  kind: 'wiki-link',
  link: { target: '', heading: null, alias: null, embed: false, ...link },
});

describe('raw markdown, exported', () => {
  it('has each wiki link as its words, escaped so they read as words', () => {
    const markdown = 'See [[a_b]] and ![[c|*d*]].[^1]';
    expect(
      exported(markdown, [
        wikiLink(markdown, '[[a_b]]', { target: 'a_b' }),
        wikiLink(markdown, '![[c|*d*]]', { target: 'c', alias: '*d*', embed: true }),
      ]),
    ).toEqual({
      markdown: 'See A\\_B and \\*d\\*.[^1]',
      dropped: [
        { kind: 'link', items: ['[[a_b]]'] },
        { kind: 'embed', items: ['![[c|*d*]]'] },
      ],
    });
  });

  it('names an image the page cannot reach, and keeps one on the web', () => {
    const markdown = '![map](attachments/map.png) ![](x.png) ![w](https://example.com/w.png)';
    const image = (piece: string, url: string, alt: string): RawPart => ({
      ...at(markdown, piece),
      kind: 'image',
      url,
      alt,
      title: null,
      reference: false,
    });
    expect(
      exported(markdown, [
        image('![map](attachments/map.png)', 'attachments/map.png', 'map'),
        image('![](x.png)', 'x.png', ''),
        image('![w](https://example.com/w.png)', 'https://example.com/w.png', 'w'),
      ]),
    ).toEqual({
      markdown: '\\[Image: map\\] \\[Image: x.png\\] ![w](https://example.com/w.png)',
      dropped: [{ kind: 'image', items: ['attachments/map.png', 'x.png'] }],
    });
  });

  it('writes an image on the web given by reference in place', () => {
    const markdown = '![The map][m]';
    const part: RawPart = {
      ...at(markdown, markdown),
      kind: 'image',
      url: 'https://example.com/m.png',
      alt: 'The map',
      title: 'Map',
      reference: true,
    };
    expect(exported(markdown, [part]).markdown).toBe('![The map](https://example.com/m.png "Map")');
  });

  it('keeps only the words of a link the page cannot follow, and lists where it went', () => {
    const markdown = 'Read [the *spec*](Docs/Spec.md) or [the site](https://example.com).';
    const link = (piece: string, words: string, url: string): RawPart => ({
      ...at(markdown, piece),
      kind: 'link',
      url,
      title: null,
      reference: false,
      words: at(markdown, words),
    });
    expect(
      exported(markdown, [
        link('[the *spec*](Docs/Spec.md)', 'the *spec*', 'Docs/Spec.md'),
        link('[the site](https://example.com)', 'the site', 'https://example.com'),
      ]),
    ).toEqual({
      markdown: 'Read the *spec* or [the site](https://example.com).',
      dropped: [{ kind: 'link', items: ['Docs/Spec.md'] }],
    });
  });

  it('writes a reference link in place, so no definition is needed, and drops every definition', () => {
    const markdown =
      'See [the site][s] and [the spec][d].\n\n[s]: https://example.com/a b\n[d]: Docs/Spec.md';
    const reference = (
      piece: string,
      words: string,
      url: string,
      title: string | null,
    ): RawPart => ({
      ...at(markdown, piece),
      kind: 'link',
      url,
      title,
      reference: true,
      words: at(markdown, words),
    });
    const definition = (piece: string, url: string): RawPart => ({
      ...at(markdown, piece),
      kind: 'definition',
      url,
    });
    expect(
      exported(markdown, [
        reference('[the site][s]', 'the site', 'https://example.com/a b', 'Say "hi"'),
        reference('[the spec][d]', 'the spec', 'Docs/Spec.md', null),
        definition('[s]: https://example.com/a b', 'https://example.com/a b'),
        definition('[d]: Docs/Spec.md', 'Docs/Spec.md'),
      ]),
    ).toEqual({
      markdown: 'See [the site](<https://example.com/a b> "Say \\"hi\\"") and the spec.\n\n\n',
      dropped: [{ kind: 'link', items: ['Docs/Spec.md'] }],
    });
  });

  it('lists a definition no reference uses when the page could not follow it', () => {
    const markdown = '[d]: Docs/Spec.md\n[s]: https://example.com';
    const definition = (piece: string, url: string): RawPart => ({
      ...at(markdown, piece),
      kind: 'definition',
      url,
    });
    expect(
      exported(markdown, [
        definition('[d]: Docs/Spec.md', 'Docs/Spec.md'),
        definition('[s]: https://example.com', 'https://example.com'),
      ]),
    ).toEqual({ markdown: '\n', dropped: [{ kind: 'link', items: ['Docs/Spec.md'] }] });
  });

  it("relabels a footnote as its note's scope says, and escapes one no note defines", () => {
    const markdown = 'Claim.[^1] Stray [^9]\n\n[^1]: Source.';
    const label = (from: number, text: string, defined: boolean): RawPart => ({
      ...at(markdown, text, from),
      kind: 'footnote-label',
      label: text,
      defined,
    });
    const parts = [label(0, '1', true), label(10, '9', false), label(20, '1', true)];
    expect(
      exported(markdown, parts, {
        footnoteLabel: (name) => `Sources-${name}`,
        escapeStrayFootnotes: true,
      }).markdown,
    ).toBe('Claim.[^Sources-1] Stray \\[^9]\n\n[^Sources-1]: Source.');
    expect(exported(markdown, parts).markdown).toBe(markdown);
  });

  it('leaves out each comment, one never closed taking the rest of its HTML, and lists it', () => {
    const markdown = 'Text <!-- b --> and\n\n<!-- draft\n\nThe plan.';
    const html = (piece: string): RawPart => ({ ...at(markdown, piece), kind: 'html' });
    expect(exported(markdown, [html('<!-- b -->'), html('<!-- draft\n\nThe plan.')])).toEqual({
      markdown: 'Text  and\n\n',
      dropped: [{ kind: 'comment', items: ['<!-- b -->', '<!-- draft\n\nThe plan.'] }],
    });
  });

  it('holds an <img> and an <a> in HTML to the rules any image or link is', () => {
    const markdown =
      '<div><img alt="Plan" src="attachments/p.png"><img src=\'https://example.com/w.png\'>' +
      '<a href="Docs/Spec.md">spec</a><a href="https://example.com">site</a>' +
      '<!-- <img src="hidden.png"> --></div>';
    expect(exported(markdown, [{ ...at(markdown, markdown), kind: 'html' }])).toEqual({
      markdown:
        "<div>\\[Image: Plan\\]<img src='https://example.com/w.png'>" +
        '<a>spec</a><a href="https://example.com">site</a></div>',
      dropped: [
        { kind: 'link', items: ['Docs/Spec.md'] },
        { kind: 'image', items: ['attachments/p.png'] },
        { kind: 'comment', items: ['<!-- <img src="hidden.png"> -->'] },
      ],
    });
  });

  it("opens a callout with its name in bold, then its title, at each quote's opening", () => {
    const markdown = '> [!warning]- Mind the gap\r\n> > [!tip]\n> > Inner.\n> Body.[^1]';
    const opening = (piece: string): RawPart => ({ ...at(markdown, piece), kind: 'quote-opening' });
    expect(
      exported(markdown, [opening('[!warning]- Mind the gap'), opening('[!tip]\n> > Inner.')]),
    ).toEqual({
      markdown: '> **Warning:** Mind the gap\r\n> > **Tip**\n> > Inner.\n> Body.[^1]',
      dropped: [{ kind: 'callout-fold', items: ['[!warning]-'] }],
    });
  });

  it('leaves a quote that does not open with a marker as it is', () => {
    const markdown = '> Text.\n> [!note] not a callout';
    const opening: RawPart = { ...at(markdown, 'Text.\n> [!note]'), kind: 'quote-opening' };
    expect(exported(markdown, [opening]).markdown).toBe(markdown);
  });

  it('keeps the outer of two parts that would rewrite the same bytes, and lists only what it rewrote', () => {
    const markdown = '> [!note] Title';
    const opening: RawPart = { ...at(markdown, '[!note] Title'), kind: 'quote-opening' };
    const reference: RawPart = {
      ...at(markdown, '[!note]'),
      kind: 'link',
      url: 'Docs/Note.md',
      title: null,
      reference: true,
      words: at(markdown, '!note'),
    };
    expect(exported(markdown, [reference, opening])).toEqual({
      markdown: '> **Note:** Title',
      dropped: [],
    });
  });

  it('takes an insertion that falls where another part ends', () => {
    const markdown = '[[a]][^9]';
    const stray: RawPart = {
      ...at(markdown, '9'),
      kind: 'footnote-label',
      label: '9',
      defined: false,
    };
    expect(
      exported(markdown, [wikiLink(markdown, '[[a]]', { target: 'a' }), stray], {
        escapeStrayFootnotes: true,
      }).markdown,
    ).toBe('A\\[^9]');
  });

  it("keeps a dropped link's words from opening their line, and from becoming a link", () => {
    const markdown =
      'Intro\n[1. Plan](a.md) and\n- [# x](b.md)\nAsk [mara@example.com `a@b`](c.md)\n' +
      'Mid [- y](d.md)\n[**b** c](e.md)\n[1.5 x](f.md)\n[#tag y](g.md)';
    const link = (piece: string, words: string): RawPart => ({
      ...at(markdown, piece),
      kind: 'link',
      url: piece.slice(piece.indexOf('](') + 2, -1),
      title: null,
      reference: false,
      words: at(markdown, words),
    });
    expect(
      exported(markdown, [
        link('[1. Plan](a.md)', '1. Plan'),
        link('[# x](b.md)', '# x'),
        link('[mara@example.com `a@b`](c.md)', 'mara@example.com `a@b`'),
        link('[- y](d.md)', '- y'),
        link('[**b** c](e.md)', '**b** c'),
        link('[1.5 x](f.md)', '1.5 x'),
        link('[#tag y](g.md)', '#tag y'),
      ]).markdown,
    ).toBe(
      'Intro\n1\\. Plan and\n- \\# x\nAsk mara\u2060@example.com `a@b`\nMid - y\n**b** c\n1.5 x\n#tag y',
    );
  });

  it('leaves words inside a dropped link to the parts read in them', () => {
    const markdown = '[![m@x](https://example.com/m.png) @home](Docs/Map.md)';
    const image: RawPart = {
      ...at(markdown, '![m@x](https://example.com/m.png)'),
      kind: 'image',
      url: 'https://example.com/m.png',
      alt: 'm@x',
      title: null,
      reference: false,
    };
    const link: RawPart = {
      ...at(markdown, markdown),
      kind: 'link',
      url: 'Docs/Map.md',
      title: null,
      reference: false,
      words: at(markdown, '![m@x](https://example.com/m.png) @home'),
    };
    expect(exported(markdown, [link, image]).markdown).toBe(
      '![m@x](https://example.com/m.png) \u2060@home',
    );
  });
});

describe('a rewrite read again', () => {
  const block = (markdown: string, type: string, depth = 0): RawPart => ({
    start: 0,
    end: markdown.length,
    kind: 'block',
    type,
    depth,
  });
  const html = (markdown: string, piece: string): RawPart => ({
    ...at(markdown, piece),
    kind: 'html',
  });

  it('is kept when it has the same blocks and goes nowhere the page cannot follow', () => {
    const markdown = 'Text <b>x</b> <!-- c -->';
    const parts = [block(markdown, 'paragraph'), html(markdown, '<!-- c -->')];
    const reread = (written: string) => [block(written, 'paragraph')];
    expect(exported(markdown, parts, { reread })).toEqual({
      markdown: 'Text <b>x</b> ',
      dropped: [{ kind: 'comment', items: ['<!-- c -->'] }],
    });
  });

  it('is shared as its words alone, and listed, when it reads as another kind of block', () => {
    const markdown = '<img src="a.png">\n  See [spec](Docs/Spec.md) at www.example.com.';
    const parts = [block(markdown, 'html'), html(markdown, markdown)];
    const reread = (written: string) => [block(written, 'paragraph')];
    expect(exported(markdown, parts, { reread })).toEqual({
      markdown: '\\[Image: a.png\\]\nSee \\[spec\\](Docs/Spec.md) at www\u2060.example.com.',
      dropped: [
        { kind: 'image', items: ['a.png'] },
        { kind: 'formatting', items: ['<img src="a.png">'] },
      ],
    });
  });

  it('is shared as its words alone when it would still link where the page cannot follow', () => {
    const markdown = 'See it[^1]';
    const reread = (written: string): RawPart[] => [
      {
        ...at(written, written),
        kind: 'link',
        url: 'Docs/Spec.md',
        title: null,
        reference: false,
        words: at(written, 'it'),
      },
    ];
    expect(exported(markdown, [], { reread }).dropped).toEqual([
      { kind: 'formatting', items: ['See it[^1]'] },
    ]);
  });

  it.each([
    [
      'a wiki link',
      { kind: 'wiki-link', link: { target: 'a', heading: null, alias: null, embed: false } },
    ],
    [
      'an image in the vault',
      { kind: 'image', url: 'a.png', alt: '', title: null, reference: false },
    ],
    ['a definition of a path', { kind: 'definition', url: 'Docs/Spec.md' }],
  ] as const)('is shared as its words alone when it still holds %s', (_label, part) => {
    const reread = (written: string): RawPart[] => [
      { ...at(written, written), ...part } as RawPart,
    ];
    expect(exported('x', [], { reread }).dropped).toEqual([{ kind: 'formatting', items: ['x'] }]);
  });

  it('is shared as its words alone when its HTML still holds a comment or goes nowhere', () => {
    for (const written of ['<!-- c -->', '<a href="Docs/x.md">x</a>', '<img src="a.png">']) {
      const reread = (text: string): RawPart[] => [{ ...at(text, text), kind: 'html' }];
      expect(exported(written, [], { reread }).dropped).toContainEqual({
        kind: 'formatting',
        items: [written],
      });
    }
  });

  it('leaves out definitions and comment-only HTML when it compares blocks', () => {
    const markdown = 'Text.\n\n[d]: https://example.com\n<!-- c -->';
    const parts: RawPart[] = [
      block(markdown, 'paragraph'),
      { ...at(markdown, '[d]: https://example.com'), kind: 'block', type: 'definition', depth: 0 },
      {
        ...at(markdown, '[d]: https://example.com'),
        kind: 'definition',
        url: 'https://example.com',
      },
      { ...at(markdown, '<!-- c -->'), kind: 'block', type: 'html', depth: 0 },
      html(markdown, '<!-- c -->'),
    ];
    const reread = (written: string) => [block(written, 'paragraph')];
    expect(exported(markdown, parts, { reread }).dropped).toEqual([
      { kind: 'comment', items: ['<!-- c -->'] },
    ]);
  });

  it('compares depth too', () => {
    const markdown = '- a';
    const parts = [block(markdown, 'list'), block(markdown, 'listItem', 1)];
    const reread = (written: string) => [block(written, 'list'), block(written, 'listItem', 2)];
    expect(exported(markdown, parts, { reread }).dropped).toEqual([
      { kind: 'formatting', items: ['- a'] },
    ]);
  });
});

describe('escapedForMarkdown', () => {
  it("escapes markdown's punctuation and leaves letters, digits and spaces", () => {
    expect(escapedForMarkdown('a*b_c [d] <e> |f| `g` ~h~ &i #j !k \\ 1. Z')).toBe(
      'a\\*b\\_c \\[d\\] \\<e\\> \\|f\\| \\`g\\` \\~h\\~ \\&i \\#j \\!k \\\\ 1. Z',
    );
  });

  it('escapes what a line could open with, so words never start a list, a heading or its underline', () => {
    expect(escapedForMarkdown('1. Kickoff')).toBe('1\\. Kickoff');
    expect(escapedForMarkdown('12) Done')).toBe('12\\) Done');
    expect(escapedForMarkdown('- item')).toBe('\\- item');
    expect(escapedForMarkdown('+ item')).toBe('\\+ item');
    expect(escapedForMarkdown('===')).toBe('\\===');
    expect(escapedForMarkdown('---')).toBe('\\---');
    expect(escapedForMarkdown('Q3 - Q4 = 1. Fine')).toBe('Q3 - Q4 = 1. Fine');
  });
});

describe('unlinkable', () => {
  it('puts an unseen word joiner where GFM would start a link, and nowhere else', () => {
    expect(unlinkable('www.example.com')).toBe('www\u2060.example.com');
    expect(unlinkable('See https://example.com')).toBe('See https:\u2060//example.com');
    expect(unlinkable('mara@example.com')).toBe('mara\u2060@example.com');
    expect(unlinkable('Summer plans › Packing')).toBe('Summer plans › Packing');
    expect(unlinkable(unlinkable('mara@www.example.com'))).toBe('mara\u2060@www\u2060.example.com');
  });
});
