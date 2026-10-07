import { describe, expect, it } from 'vitest';
import { parseBodyToMdast } from './markdown-blocks.ts';
import { plainTextOf } from './plain-text.ts';

const text = (markdown: string) => plainTextOf(parseBodyToMdast(markdown));

describe('plainTextOf', () => {
  it('keeps the words of a paragraph', () => {
    expect(text('Just some words.\n')).toBe('Just some words.');
  });

  it('drops emphasis markers but keeps the words together', () => {
    expect(text('a **bold** word\n')).toBe('a bold word');
  });

  it('keeps heading text', () => {
    expect(text('# Weekly review\n\nbody\n')).toBe('Weekly review body');
  });

  it('keeps code so a snippet can be searched for', () => {
    expect(text('```ts\nconst answer = 42;\n```\n')).toContain('const answer = 42;');
  });

  it('keeps inline code', () => {
    expect(text('use `pnpm gate` here\n')).toBe('use pnpm gate here');
  });

  it('keeps link text but not the URL', () => {
    expect(text('see [the docs](https://example.com/secret)\n')).toBe('see the docs');
  });

  it('keeps a wiki link target, since that is its name', () => {
    expect(text('see [[Weekly review]] here\n')).toContain('Weekly review');
  });

  it('keeps image alt text', () => {
    expect(text('![a diagram](pic.png)\n')).toBe('a diagram');
  });

  it('drops raw html', () => {
    expect(text('<div class="secret">x</div>\n')).toBe('');
  });

  // A search for "bookmark" must not find every note holding a card (A22-01).
  it('drops a bookmark’s marker and any other comment, keeping the link', () => {
    expect(text('[[Rome]] <!-- atlas:bookmark -->\n\nA <!-- note to self --> B\n')).toBe(
      '[[Rome]] A B',
    );
  });

  it('keeps a comment written as code: it is shown, so it is searched', () => {
    expect(text('Type `<!-- x -->` to hide x.\n')).toBe('Type <!-- x --> to hide x.');
  });

  it('keeps list items', () => {
    expect(text('- one\n- two\n')).toBe('one two');
  });

  it('keeps table cells', () => {
    expect(text('| a | b |\n| - | - |\n| 1 | 2 |\n')).toBe('a b 1 2');
  });

  it('returns nothing for an empty body', () => {
    expect(text('')).toBe('');
  });
});
