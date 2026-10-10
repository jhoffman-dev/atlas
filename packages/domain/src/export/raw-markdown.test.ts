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

  it('leaves out an id the reader found, and lists it', () => {
    const markdown = 'Text <b>x</b> ^r1';
    expect(exported(markdown, [{ ...at(markdown, ' ^r1'), kind: 'block-id', id: 'r1' }])).toEqual({
      markdown: 'Text <b>x</b>',
      dropped: [{ kind: 'block-id', items: ['r1'] }],
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

  it('refuses parts that overlap, rather than write over one', () => {
    const markdown = '[[a]]';
    const link = wikiLink(markdown, '[[a]]', { target: 'a' });
    expect(() => exported(markdown, [link, { ...link, start: 1 }])).toThrow(/overlap/);
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
  });
});
