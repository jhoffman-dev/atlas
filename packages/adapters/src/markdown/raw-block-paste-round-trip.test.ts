import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '@dfai/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * Issue #541: a raw block pasted in the editor is a new `rawBlock` holding the
 * copied source and no block id. Saved, it is written as that source, byte for
 * byte, and the original is kept as it was.
 */
const TABLE = '| Seed | Days |\n| --- | --- |\n| Kale | 55 |';
const HTML_BLOCK = '<details>\n<summary>Fern notes</summary>\nSpores in autumn.\n</details>';

const pasted = (markdown: string) => ({ type: 'rawBlock', attrs: { markdown } });

describe('a raw block pasted into a note, saved', () => {
  it.each([
    ['table', TABLE],
    ['raw HTML block', HTML_BLOCK],
  ])('writes a pasted %s byte-identical beside the original', (_label, source) => {
    const originalBody = `Above.\n\n${source}\n\nBelow.\n`;
    const parsed = parseMarkdownBody(originalBody);
    const doc: EditorDocument = { type: 'doc', content: [...parsed.doc.content, pasted(source)] };
    expect(serializeMarkdownBody({ originalBody, parsed, doc })).toBe(
      `Above.\n\n${source}\n\nBelow.\n\n${source}\n`,
    );
  });

  it.each([
    ['table', TABLE],
    ['raw HTML block', HTML_BLOCK],
  ])('writes a %s pasted into an empty note byte-identical', (_label, source) => {
    const parsed = parseMarkdownBody('');
    const doc: EditorDocument = { type: 'doc', content: [pasted(source)] };
    expect(serializeMarkdownBody({ originalBody: '', parsed, doc })).toBe(`${source}\n`);
  });

  it.each([
    ['table', TABLE],
    ['raw HTML block', HTML_BLOCK],
  ])('writes a %s pasted into a CRLF note with CRLF, keeping the original', (_label, source) => {
    const crlf = (text: string) => text.replace(/\n/g, '\r\n');
    const originalBody = crlf(`Above.\n\n${source}\n\nBelow.\n`);
    const parsed = parseMarkdownBody(originalBody);
    // The clipboard's HTML holds LF only: an HTML parser reads every CRLF as LF.
    const doc: EditorDocument = { type: 'doc', content: [...parsed.doc.content, pasted(source)] };
    expect(serializeMarkdownBody({ originalBody, parsed, doc })).toBe(
      crlf(`Above.\n\n${source}\n\nBelow.\n\n${source}\n`),
    );
  });
});
