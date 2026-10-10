import type { RawPart } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { readRawParts } from './raw-parts.ts';

/** Each part but the blocks, as the markdown it covers, with what it says beyond where it is. */
const read = (markdown: string, definitions: string[] = []) =>
  readRawParts(markdown, definitions)
    .filter((part) => part.kind !== 'block')
    .map(({ start, end, ...part }) => ({ ...part, source: markdown.slice(start, end) }));

/** The blocks the markdown is shaped as: each one's type, at its depth. */
const shapeOf = (markdown: string) =>
  readRawParts(markdown, []).flatMap((part) =>
    part.kind === 'block' ? [`${'  '.repeat(part.depth)}${part.type}`] : [],
  );

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
    const link = readRawParts('[*the* spec](Docs/Spec.md)', []).find(
      (part) => part.kind === 'link',
    );
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

  it('finds no id: the editor reads none inside a block it does not model', () => {
    const ids = (markdown: string) =>
      readRawParts(markdown, []).filter((part) => (part.kind as string) === 'block-id');
    expect(ids('Text <b>x</b> ^r1')).toEqual([]);
    expect(ids('## Heading <b>x</b> ^h1')).toEqual([]);
    expect(ids('- One <b>x</b> ^a1\n- [ ] ^c3')).toEqual([]);
  });

  it('reads the blocks the markdown is shaped as, at their depths, and only its own', () => {
    expect(shapeOf('> - a <b>x</b>\n>   - b\n\n<div>\nc\n</div>')).toEqual([
      'blockquote',
      '  list',
      '    listItem',
      '      paragraph',
      '      list',
      '        listItem',
      '          paragraph',
      'html',
    ]);
    expect(readRawParts('Text <b>x</b>', ['[d]: https://example.com'])).not.toContainEqual(
      expect.objectContaining({ kind: 'block', type: 'definition' }),
    );
  });

  it("reads a reference by the first definition of its label in the note, the block's own after those in reach", () => {
    const urlOf = (markdown: string, definitions: string[]) =>
      readRawParts(markdown, definitions).find((part) => part.kind === 'link');
    expect(
      urlOf('> [c][dup]\n>\n> [dup]: https://example.com/2', [
        '[dup]: https://example.com/1',
        '[dup]: https://example.com/2',
      ]),
    ).toMatchObject({ url: 'https://example.com/1' });
    expect(urlOf('[c][dup]\n\n[dup]: https://example.com/2', [])).toMatchObject({
      url: 'https://example.com/2',
    });
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
