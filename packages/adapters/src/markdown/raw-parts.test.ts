import type { RawPart } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { readRawParts } from './raw-parts.ts';

/** Each part as the markdown it covers, with what it says beyond where it is. */
const read = (markdown: string, definitions: string[] = []) =>
  readRawParts(markdown, definitions).map(({ start, end, ...part }) => ({
    ...part,
    source: markdown.slice(start, end),
  }));

const ofKind = <Kind extends RawPart['kind']>(
  parts: ReturnType<typeof read>,
  kind: Kind,
): ReturnType<typeof read> => parts.filter((part) => part.kind === kind);

describe('readRawParts', () => {
  it('finds wiki links, images and links, and where a link keeps its words', () => {
    const parts = read('See [[Plans|the plan]] ![map](a.png "M") [*the* spec](Docs/Spec.md).[^1]');
    expect(ofKind(parts, 'wiki-link')).toEqual([
      {
        kind: 'wiki-link',
        link: { target: 'Plans', heading: null, alias: 'the plan', embed: false },
        source: '[[Plans|the plan]]',
      },
    ]);
    expect(ofKind(parts, 'image')).toEqual([
      {
        kind: 'image',
        url: 'a.png',
        alt: 'map',
        title: 'M',
        reference: false,
        source: '![map](a.png "M")',
      },
    ]);
    const [link] = readRawParts('[*the* spec](Docs/Spec.md)', []);
    expect(link).toMatchObject({
      kind: 'link',
      url: 'Docs/Spec.md',
      reference: false,
      words: { start: 1, end: 11 },
    });
  });

  it('reads a reference by the definitions in reach, and the definitions themselves', () => {
    const parts = read('[the site][s] and ![pic][p]', [
      '[s]: https://example.com "Site"',
      '[p]: pic.png',
    ]);
    expect(parts).toEqual([
      expect.objectContaining({
        kind: 'link',
        url: 'https://example.com',
        title: 'Site',
        reference: true,
        source: '[the site][s]',
      }),
      expect.objectContaining({
        kind: 'image',
        url: 'pic.png',
        alt: 'pic',
        reference: true,
        source: '![pic][p]',
      }),
    ]);
    expect(read('[s]: Docs/Spec.md')).toEqual([
      { kind: 'definition', url: 'Docs/Spec.md', source: '[s]: Docs/Spec.md' },
    ]);
  });

  it("reads a footnote as defined only when its definition is in reach, and its label's place", () => {
    const labels = (markdown: string, definitions: string[] = []) =>
      ofKind(read(markdown, definitions), 'footnote-label').map(({ source, ...part }) => ({
        ...part,
        source,
      }));
    expect(labels('Claim.[^n1]', ['[^n1]: Source.'])).toEqual([
      { kind: 'footnote-label', label: 'n1', defined: true, source: 'n1' },
    ]);
    expect(labels('Claim.[^n1]')).toEqual([
      { kind: 'footnote-label', label: 'n1', defined: false, source: 'n1' },
    ]);
    expect(labels('Escaped \\[^n1].')).toEqual([]);
    expect(read('[^n1]: Source.')).toEqual([
      { kind: 'footnote-definition', source: '[^n1]: Source.' },
      { kind: 'footnote-label', label: 'n1', defined: true, source: 'n1' },
    ]);
  });

  it('finds HTML, and a comment never closed runs to the end of the block, not into the definitions', () => {
    expect(read('Text <b>x</b>')).toEqual([
      { kind: 'html', source: '<b>' },
      { kind: 'html', source: '</b>' },
    ]);
    expect(read('<!-- draft\n\nSecret.', ['[s]: https://example.com'])).toEqual([
      { kind: 'html', source: '<!-- draft\n\nSecret.' },
    ]);
    const [comment] = readRawParts('<!-- draft', ['[s]: https://example.com']);
    expect(comment).toMatchObject({ start: 0, end: '<!-- draft'.length });
  });

  it('finds an id where the editor reads one: ending a paragraph, a heading or a list item, or after a box', () => {
    const ids = (markdown: string) => ofKind(read(markdown), 'block-id').map((part) => part.source);
    expect(ids('Text <b>x</b> ^r1')).toEqual([' ^r1']);
    expect(ids('## Heading <b>x</b> ^h1')).toEqual([' ^h1']);
    expect(ids('- One <b>x</b> ^a1\n  - Two ^b2\n- [ ] ^c3')).toEqual([' ^a1', ' ^b2', '^c3']);
  });

  it('finds no id mid-paragraph, in code, or inside a quote, where the editor reads none', () => {
    const ids = (markdown: string) => ofKind(read(markdown), 'block-id');
    expect(ids('One ^a1\ntwo <b>x</b>')).toEqual([]);
    expect(ids('Start `span\nend ^c1` <b>x</b>')).toEqual([]);
    expect(ids('> Quoted <b>x</b> ^q1')).toEqual([]);
  });

  it("finds where each quote's text opens, nested ones too", () => {
    expect(ofKind(read('> [!note] A\n> > [!tip]- B\n> > b <b>x</b>'), 'quote-opening')).toEqual([
      { kind: 'quote-opening', source: '[!note] A' },
      { kind: 'quote-opening', source: '[!tip]- B\n> > b <b>x</b>' },
    ]);
  });

  it('finds nothing in code', () => {
    expect(read('```\n[[x]] ![a](b.png) <!-- c --> [^1]\n```')).toEqual([]);
    expect(read('Text `[[x]] <b>` here')).toEqual([]);
  });
});
