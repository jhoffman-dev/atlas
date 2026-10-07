import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorMark, EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * The cases card A21-03 names: an edited block that did not read back as the
 * editor had it, or changed what the file said where the edit did not reach.
 */

const text = (value: string, marks: readonly EditorMark['type'][] = []): EditorNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 && { marks: marks.map((type) => ({ type })) }),
});

const wikiLink = (target: string): EditorNode => ({
  type: 'wikiLink',
  attrs: { target, heading: null, alias: null },
});

/** A new note holding `blocks`, saved. */
const written = (...blocks: EditorNode[]): string =>
  serializeMarkdownBody({
    originalBody: '',
    parsed: parseMarkdownBody(''),
    doc: { type: 'doc', content: blocks },
  });

/** `markdown` with `Q ` typed at the start of each of its paragraphs, saved. */
function typedInto(markdown: string): string {
  const parsed = parseMarkdownBody(markdown);
  const edit = (node: EditorNode): EditorNode =>
    node.type === 'paragraph'
      ? { ...node, content: [text('Q '), ...(node.content ?? [])] }
      : node.content === undefined
        ? node
        : { ...node, content: node.content.map(edit) };
  const doc: EditorDocument = { type: 'doc', content: parsed.doc.content.map(edit) };
  return serializeMarkdownBody({ originalBody: markdown, parsed, doc });
}

const blocksOf = (markdown: string) => parseMarkdownBody(markdown).doc.content;

describe('entities in an edited paragraph', () => {
  it('keeps &amp; and &copy; as they were written', () => {
    expect(typedInto('AT&amp;T, &copy; 2026\n')).toBe('Q AT&amp;T, &copy; 2026\n');
  });

  it('keeps an entity inside bold', () => {
    expect(typedInto('**Tom &amp; Jerry**\n')).toBe('Q **Tom &amp; Jerry**\n');
  });
});

describe('whitespace markdown cannot hold', () => {
  it('drops a space that starts a paragraph rather than writing &#x20;', () => {
    expect(written({ type: 'paragraph', content: [text(' Lead')] })).toBe('Lead\n');
  });

  it('puts the space that ends bold outside it, before a link', () => {
    const saved = written({
      type: 'paragraph',
      content: [text('See ', ['bold']), wikiLink('Name')],
    });
    expect(saved).toBe('**See** [[Name]]\n');
  });
});

describe('wiki links', () => {
  it('keeps an escaped \\[\\[x]] as text, not a link', () => {
    const [paragraph] = blocksOf('Say \\[\\[x]] here\n');
    expect(paragraph?.content?.map((node) => node.type)).toEqual(['text']);
    expect(typedInto('Say \\[\\[x]] here\n')).toBe('Q Say \\[\\[x]] here\n');
  });

  it.each(['_draft_', 'a*b*c', 'x `y` z', '~~s~~'])(
    'reads [[%s]] inside a line as one link, with no markup in its name',
    (target) => {
      const [paragraph] = blocksOf(`See [[${target}]] now\n`);
      expect(paragraph?.content).toEqual([text('See '), wikiLink(target), text(' now')]);
    },
  );
});

describe('a CRLF file', () => {
  it('writes an edited block with the file’s own line endings', () => {
    const saved = typedInto('# Title\r\n\r\n> one\r\n> two\r\n\r\nEnd\r\n');
    expect(saved.replace(/\r\n/g, '')).not.toContain('\n');
    expect(saved).toBe('# Title\r\n\r\n> Q one\r\n> two\r\n\r\nQ End\r\n');
  });

  it('still writes the text of a paragraph that runs over lines as typed', () => {
    expect(typedInto('Say [x] and\r\nmore\r\n')).toBe('Q Say [x] and\r\nmore\r\n');
  });
});

describe('text remark itself writes so that it reads differently', () => {
  it('keeps the bold on **k<&]]&k** in a table cell', () => {
    const cell = (type: string, content: EditorNode[]): EditorNode => ({
      type,
      content: [{ type: 'paragraph', content }],
    });
    const table: EditorNode = {
      type: 'table',
      attrs: { align: [null] },
      content: [
        { type: 'tableRow', content: [cell('tableHeader', [text('h')])] },
        { type: 'tableRow', content: [cell('tableCell', [text('k<&]]&k', ['bold'])])] },
      ],
    };
    const [reread] = blocksOf(written(table));
    const inCell = reread?.content?.[1]?.content?.[0]?.content?.[0]?.content;
    expect(inCell).toEqual([text('k<&]]&k', ['bold'])]);
  });

  it('keeps the tildes after www. as text', () => {
    const [reread] = blocksOf(written({ type: 'paragraph', content: [text('www.~~k')] }));
    expect(reread?.content?.map((node) => node.text).join('')).toBe('www.~~k');
  });
});

describe('what markdown can say only one way', () => {
  const list = (type: string, item: string, ...texts: string[]): EditorNode => ({
    type,
    content: texts.map((value) => ({
      type: item,
      ...(item === 'taskItem' && { attrs: { checked: true } }),
      content:
        value === '' ? [{ type: 'paragraph' }] : [{ type: 'paragraph', content: [text(value)] }],
    })),
  });

  it('keeps two lists side by side two lists, by their markers', () => {
    const saved = written(list('bulletList', 'listItem', 'a'), list('taskList', 'taskItem', 'b'));
    expect(saved).toBe('- a\n\n* [x] b\n');
    expect(blocksOf(saved).map((node) => node.type)).toEqual(['bulletList', 'taskList']);
  });

  it('keeps an empty task a task, and checked', () => {
    const [reread] = blocksOf(written(list('taskList', 'taskItem', '')));
    expect(reread?.type).toBe('taskList');
    expect(reread?.content?.[0]?.attrs?.['checked']).toBe(true);
  });

  it('writes a line break in a level-three heading as <br>, and reads it back', () => {
    const heading: EditorNode = {
      type: 'heading',
      attrs: { level: 3 },
      content: [text('one'), { type: 'hardBreak' }, text('two')],
    };
    const saved = written(heading);
    expect(saved).toBe('### one<br>two\n');
    expect(blocksOf(saved)[0]?.content?.map((node) => node.type)).toEqual([
      'text',
      'hardBreak',
      'text',
    ]);
  });

  it('keeps the no-break spaces that start a paragraph, which markdown keeps too', () => {
    expect(typedInto('&nbsp;&nbsp;Indented\n')).toBe('Q &nbsp;&nbsp;Indented\n');
  });
});
