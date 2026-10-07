import { describe, expect, it } from 'vitest';
import type { EditorMark, EditorNode } from '@atlas/domain';
import { parseMarkdownBody } from './markdown-blocks.ts';
import { readingOf, readsAs } from './reading.ts';

const text = (value: string, marks: EditorMark[] = []): EditorNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 && { marks }),
});
const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const linkTo = (href: string): EditorMark => ({ type: 'link', attrs: { href, title: null } });
const bold: EditorMark = { type: 'bold' };

/** Whether `markdown`, parsed, reads as the editor document `nodes`. */
const readsAsDocument = (markdown: string, ...nodes: EditorNode[]) =>
  readsAs(readingOf(parseMarkdownBody(markdown).doc.content), readingOf(nodes));

describe('what a block reads as', () => {
  it('is the same however its text is split, and without its trailing space', () => {
    expect(
      readsAsDocument('a **b** c', paragraph(text('a '), text('b', [bold]), text(' c '))),
    ).toBe(true);
  });

  it('differs when a mark appears, disappears or moves', () => {
    const document = paragraph(text('a '), text('b', [bold]), text(' c'));
    expect(readsAsDocument('a b c', document)).toBe(false);
    expect(readsAsDocument('**a** b c', document)).toBe(false);
    expect(readsAsDocument('a **b c**', document)).toBe(false);
  });

  it('differs when the block around the text differs', () => {
    expect(readsAsDocument('# a', paragraph(text('a')))).toBe(false);
    expect(readsAsDocument('> a', paragraph(text('a')))).toBe(false);
  });

  it.each([
    ['an email', 'julie@example.com', 'mailto:julie@example.com'],
    ['a web address', 'https://example.com', 'https://example.com'],
    ['a www address', 'www.example.com', 'http://www.example.com'],
  ])('lets %s held as plain text read back as the link GFM makes of it', (_label, typed, href) => {
    // Pins GFM's addresses for such links: if they change, this one fails.
    const [read] = parseMarkdownBody(`See ${typed}`).doc.content;
    expect(read?.content?.[1]?.marks).toEqual([linkTo(href)]);
    expect(readsAsDocument(`See ${typed}`, paragraph(text(`See ${typed}`)))).toBe(true);
  });

  it('keeps a link the document has, and to the same address', () => {
    const linked = paragraph(
      text('See '),
      text('julie@example.com', [linkTo('mailto:julie@example.com')]),
    );
    expect(readsAsDocument('See julie@example.com', linked)).toBe(true);
    expect(readsAsDocument('See `julie@example.com`', linked)).toBe(false);
    expect(readsAsDocument('See [julie@example.com](mailto:other@example.com)', linked)).toBe(
      false,
    );
  });

  it('does not let a link GFM makes reach past the address', () => {
    // `.co` is plain text in the document, so a link over it is new markup.
    const document = paragraph(
      text('julie@example.com', [linkTo('mailto:julie@example.com')]),
      text('.co'),
    );
    expect(readsAsDocument('julie@example.com.co', document)).toBe(false);
  });

  it('does not let a link to anywhere else stand for plain text', () => {
    expect(readsAsDocument('[site](https://example.com)', paragraph(text('site')))).toBe(false);
  });
});
