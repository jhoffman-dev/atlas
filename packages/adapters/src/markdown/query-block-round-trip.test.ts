import { describe, expect, it } from 'vitest';
import {
  BLOCK_ID_ATTR,
  queryBlockFence,
  queryBlockNode,
  type EditorDocument,
  type EditorNode,
} from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * A query block in the file is a fenced code block whose language is
 * `atlas-query` (P30-05): Obsidian shows it as code, Atlas as the answer to
 * the query. It is read as a query block only at the top of the note, kept
 * byte for byte when untouched, and written so it reads back as itself.
 */
const QUERY = 'layout: list\nFROM meeting WHERE people = this SORT BY date DESC';

const blocks = (markdown: string) => parseMarkdownBody(markdown).doc.content;

/** The body saved after `edit` has changed its document's blocks. */
function saveAfter(markdown: string, edit: (content: EditorNode[]) => EditorNode[]): string {
  const parsed = parseMarkdownBody(markdown);
  const doc: EditorDocument = { type: 'doc', content: edit([...parsed.doc.content]) };
  return serializeMarkdownBody({ originalBody: markdown, parsed, doc });
}

const withoutId = ({ attrs, ...node }: EditorNode): EditorNode => {
  const rest = Object.fromEntries(
    Object.entries(attrs ?? {}).filter(([key]) => key !== BLOCK_ID_ATTR),
  );
  return Object.keys(rest).length === 0 ? node : { ...node, attrs: rest };
};

const typesOf = (markdown: string) => blocks(markdown).map((node) => node.type);

describe('reading a query block', () => {
  it('reads an atlas-query fence as a query block holding the fence’s text', () => {
    expect(blocks(`\`\`\`atlas-query\n${QUERY}\n\`\`\`\n`).map(withoutId)).toEqual([
      queryBlockNode(QUERY),
    ]);
  });

  it.each([
    ['a tilde fence', `~~~atlas-query\n${QUERY}\n~~~\n`],
    ['a longer fence', `\`\`\`\`atlas-query\n${QUERY}\n\`\`\`\`\n`],
  ])('reads %s the same', (_label, markdown) => {
    expect(blocks(markdown).map(withoutId)).toEqual([queryBlockNode(QUERY)]);
  });

  it.each([
    ['another language', '```sql\nSELECT 1\n```\n', ['codeBlock']],
    ['no language', '```\nFROM task\n```\n', ['codeBlock']],
    ['words after the language', '```atlas-query wide\nFROM task\n```\n', ['codeBlock']],
    ['a language in capitals', '```Atlas-Query\nFROM task\n```\n', ['codeBlock']],
    ['indented code', '    FROM task\n', ['codeBlock']],
    ['a fence in a list', '- one\n\n  ```atlas-query\n  FROM task\n  ```\n', ['bulletList']],
    ['a fence in a quote', '> ```atlas-query\n> FROM task\n> ```\n', ['blockquote']],
  ])('leaves %s as it was', (_label, markdown, types) => {
    expect(typesOf(markdown)).toEqual(types);
    expect(JSON.stringify(blocks(markdown))).not.toContain('queryBlock');
    expect(saveAfter(markdown, (content) => content)).toBe(markdown);
  });
});

describe('a query block copied as plain text', () => {
  it.each([
    ['a query', QUERY],
    ['nothing', ''],
    ['backticks', 'FROM task WHERE title = "```"\n````'],
  ])('reads back as the block it was, holding %s', (_label, text) => {
    expect(blocks(`${queryBlockFence(text)}\n`).map(withoutId)).toEqual([queryBlockNode(text)]);
  });
});

describe('saving a note with a query block', () => {
  it.each([
    ['backticks', `\`\`\`atlas-query\n${QUERY}\n\`\`\`\n`],
    ['tildes', `~~~atlas-query\n${QUERY}\n~~~\n`],
    ['a longer fence and no closing newline', `\`\`\`\`atlas-query\n${QUERY}\n\`\`\`\``],
    ['an unclosed fence', `\`\`\`atlas-query\n${QUERY}\n`],
    ['CRLF', `Intro.\r\n\r\n\`\`\`atlas-query\r\n${QUERY.replace('\n', '\r\n')}\r\n\`\`\`\r\n`],
    ['a block id after it', `\`\`\`atlas-query\n${QUERY}\n\`\`\`\n\n^q1abc\n`],
    ['nothing in it', '```atlas-query\n```\n'],
  ])('keeps %s byte for byte when untouched', (_label, markdown) => {
    expect(saveAfter(markdown, (content) => content)).toBe(markdown);
  });

  it('keeps its bytes when the paragraph beside it is edited', () => {
    const markdown = `Before.\n\n~~~atlas-query\n${QUERY}\n~~~\n`;
    const saved = saveAfter(markdown, ([first, ...rest]) => [
      { ...first!, content: [{ type: 'text', text: 'Changed.' }] },
      ...rest,
    ]);
    expect(saved).toBe(`Changed.\n\n~~~atlas-query\n${QUERY}\n~~~\n`);
  });

  it('writes its new text as the fence, which reads back as the query block it was', () => {
    const markdown = `Intro.\n\n\`\`\`atlas-query\n${QUERY}\n\`\`\`\n\nAfter.\n`;
    const edited = 'FROM task WHERE status != done';
    const saved = saveAfter(markdown, (content) =>
      content.map((node) =>
        node.type === 'queryBlock' ? { ...node, attrs: { ...node.attrs, text: edited } } : node,
      ),
    );
    expect(saved).toBe(`Intro.\n\n\`\`\`atlas-query\n${edited}\n\`\`\`\n\nAfter.\n`);
    expect(blocks(saved).map(withoutId)[1]).toEqual(queryBlockNode(edited));
  });

  it('writes a new query block as a fence with its language', () => {
    const saved = saveAfter('Intro.\n', (content) => [...content, queryBlockNode(QUERY)]);
    expect(saved).toBe(`Intro.\n\n\`\`\`atlas-query\n${QUERY}\n\`\`\`\n`);
  });

  it('writes a fence inside its text with a longer fence, and reads the text back whole', () => {
    const text = 'FROM task WHERE title = "```"\n```';
    const saved = saveAfter('', () => [queryBlockNode(text)]);
    expect(blocks(saved).map(withoutId)).toEqual([queryBlockNode(text)]);
  });

  it('writes one held inside a list as the code block it is there', () => {
    const list: EditorNode = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [queryBlockNode('FROM task')] }],
    };
    const saved = saveAfter('', () => [list]);
    expect(saved).toContain('```atlas-query\n  FROM task\n  ```');
    expect(typesOf(saved)).toEqual(['bulletList']);
  });
});
