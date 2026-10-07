import { describe, expect, it } from 'vitest';
import { splitWikiLinks, type EditorDocument, type EditorNode } from '@atlas/domain';
import { parseBodyToMdast, parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * Adversarial pass on A21-03 (the wiki link as one token, CRLF, `<br>` in
 * cells). Two promises: opening a note reads it as before unless the old
 * reading was wrong, and saving an edit reads back as the editor had it while
 * every untouched block keeps its bytes (ADR-0003).
 */

/** A block read holds its id in `attrs`, which a block with no attributes of its own lacks. */
const onlyAnId = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  Object.keys(value).every((key) => key === 'blockId');

const withoutIds = (nodes: readonly EditorNode[]): unknown =>
  JSON.parse(
    JSON.stringify(nodes, (key, value: unknown) =>
      key === 'blockId' || (key === 'attrs' && onlyAnId(value)) ? undefined : value,
    ),
  );

const read = (markdown: string) => withoutIds(parseMarkdownBody(markdown).doc.content);

/** `markdown` with `Q ` typed at the start of the first paragraph or heading of block `at`. */
function typedIntoBlock(markdown: string, at: number): string {
  const parsed = parseMarkdownBody(markdown);
  let typed = false;
  const edit = (node: EditorNode): EditorNode => {
    if (typed) return node;
    if (node.type === 'paragraph' || node.type === 'heading') {
      typed = true;
      return { ...node, content: [{ type: 'text', text: 'Q ' }, ...(node.content ?? [])] };
    }
    return node.content === undefined ? node : { ...node, content: node.content.map(edit) };
  };
  const doc: EditorDocument = {
    type: 'doc',
    content: parsed.doc.content.map((node, index) => (index === at ? edit(node) : node)),
  };
  return serializeMarkdownBody({ originalBody: markdown, parsed, doc });
}

/** A new note holding `blocks`, saved. */
const written = (...blocks: EditorNode[]): string =>
  serializeMarkdownBody({
    originalBody: '',
    parsed: parseMarkdownBody(''),
    doc: { type: 'doc', content: blocks },
  });

const oneCellTable = (inline: EditorNode[]): EditorNode => ({
  type: 'table',
  attrs: { align: [null] },
  content: [
    {
      type: 'tableRow',
      content: [
        {
          type: 'tableHeader',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }],
        },
      ],
    },
    {
      type: 'tableRow',
      content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: inline }] }],
    },
  ],
});

describe('a callout whose title holds a wiki link (A21-03 regression)', () => {
  it('reads the whole first line as the title, link and all, as it did before', () => {
    expect(read('> [!note] See [[Plan]]\n> body\n')).toEqual([
      {
        type: 'callout',
        attrs: { kind: 'note', title: 'See [[Plan]]', fold: null },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
      },
    ]);
  });

  it('keeps a title that is only a link as the title, not as the first words of the body', () => {
    const [callout] = parseMarkdownBody('> [!note] [[Plan]]\n> body\n').doc.content;
    expect(callout?.attrs?.['title']).toBe('[[Plan]]');
  });

  it("keeps the title line's bytes when only the body is edited", () => {
    expect(typedIntoBlock('> [!note] See [[Plan]]\n> body\n', 0)).toBe(
      '> [!note] See [[Plan]]\n> Q body\n',
    );
  });
});

describe('opening a note saved on Windows', () => {
  it('reads a callout written with CRLF as a callout', () => {
    const [block] = parseMarkdownBody('> [!note] Title\r\n> body\r\n').doc.content;
    expect(block?.type).toBe('callout');
  });
});

describe('an untouched block keeps its bytes when a neighbour is edited', () => {
  it('in a note that starts with a byte-order mark', () => {
    const saved = typedIntoBlock('\uFEFF# Title\n\nPara one\n\nPara two\n', 1);
    expect(saved).toBe('\uFEFF# Title\n\nQ Para one\n\nPara two\n');
  });

  it('when the untouched block is an &nbsp; spacer paragraph', () => {
    expect(typedIntoBlock('a\n\n&nbsp;\n\nb\n', 0)).toBe('Q a\n\n&nbsp;\n\nb\n');
  });

  // A row with more cells than its header is kept as its source (A21-04): the
  // editor could only drop the cell markdown hides, or add a column. The
  // expectation read the header from the editor, which no longer holds such a
  // table, so it is read from the markdown, and the bytes are checked too.
  it('when a table row holds an unescaped [[x|y]] and a header cell is edited', () => {
    const note = '| h1 | h2 |\n| - | - |\n| a | [[x|y]] |\n';
    const saved = typedIntoBlock(note, 0);
    const [table] = parseBodyToMdast(saved).children;
    expect(table?.type === 'table' && table.children[0]?.children.length, saved).toBe(2);
    expect(saved).toBe(note);
  });
});

describe('an edited block reads back as the editor had it', () => {
  // A cell reads `\|` in code as `|` and `\\` as itself (mdast-util-gfm-table),
  // so no writing of `a\|` in a cell's code keeps the cell whole: `\\|` ends
  // it. The writer adds a backslash, keeping the cell and every character
  // (A21-04); the expectation was changed from `a\|`, which no markdown reads.
  it('for inline code ending in a backslash and a pipe, in a table cell, as a cell can hold it', () => {
    const cell = [{ type: 'text', text: 'a\\|', marks: [{ type: 'code' }] }] as EditorNode[];
    const held = [{ type: 'text', text: 'a\\\\|', marks: [{ type: 'code' }] }] as EditorNode[];
    const markdown = written(oneCellTable(cell));
    expect(read(markdown), markdown).toEqual(withoutIds([oneCellTable(held)]));
  });

  it('for bold text ending in `<` before inline code ending in `>`', () => {
    const paragraph: EditorNode = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'x<', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'a@b.co>', marks: [{ type: 'code' }] },
      ],
    };
    const markdown = written(paragraph);
    expect(read(markdown), markdown).toEqual(withoutIds([paragraph]));
  });
});

/**
 * The index takes a note's links from `splitWikiLinks` over the raw body
 * (`refresh-index.ts`), the editor from the parser. Where they disagree, a
 * backlink is listed that the note does not show, or one it shows is missing.
 */
describe('the index and the editor agree on what is a wiki link', () => {
  const targetsInEditor = (markdown: string): string[] => {
    const found: string[] = [];
    const visit = (node: EditorNode) => {
      if (node.type === 'wikiLink') found.push(String(node.attrs?.['target']));
      node.content?.forEach(visit);
    };
    parseMarkdownBody(markdown).doc.content.forEach(visit);
    return found;
  };
  const targetsInIndex = (markdown: string): string[] =>
    splitWikiLinks(markdown).flatMap((piece) => (piece.kind === 'wikiLink' ? [piece.target] : []));

  it.each([
    [
      'an aliased link in a table cell, as the writer now writes it',
      '| h |\n| - |\n| [[Plan\\|the plan]] |\n',
    ],
    ['a link whose first bracket is escaped', 'See \\[[Plan]] here.\n'],
    ['a link broken over two lines', 'See [[Plan\nNext]] here.\n'],
    ['a link in a code span', 'See `[[Plan]]` here.\n'],
  ])('for %s', (_, markdown) => {
    expect(targetsInIndex(markdown)).toEqual(targetsInEditor(markdown));
  });
});
