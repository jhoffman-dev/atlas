import { describe, expect, it } from 'vitest';
import { splitWikiLinks, type EditorDocument, type EditorNode } from '@atlas/domain';
import { parseBodyToMdast, parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';
import { plainTextOf } from './plain-text.ts';

/**
 * The code-reviewer's findings on A21-03 (card A21-04), each as the behaviour
 * it should have: `<br>` read only where it is written, the spaces beside it
 * kept, `- - -` not taken for a list, plain text not spacing out links, and
 * code spans deciding what is a link the same way for the index and the editor.
 */

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

describe('a line break in a heading is written as it is read', () => {
  it('keeps `<br>` in a level-one heading when the heading is edited', () => {
    expect(typedIntoBlock('# a<br>b\n', 0)).toBe('# Q a<br>b\n');
  });

  it('writes a break typed into a level-two heading as `<br>`, which it reads back', () => {
    const heading: EditorNode = {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }],
    };
    expect(written(heading)).toBe('## a<br>b\n');
  });
});

describe('the spaces beside `<br>`', () => {
  it('are kept in a heading that is edited', () => {
    expect(typedIntoBlock('### a <br> b\n', 0)).toBe('### Q a <br> b\n');
  });

  it('are kept in a table cell when another cell is edited', () => {
    expect(typedIntoBlock('| h |\n| - |\n| a <br> b |\n', 0)).toBe(
      '| Q h |\n| - |\n| a <br> b |\n',
    );
  });
});

describe('a `- - -` separator beside a list', () => {
  it('is not taken for a list when the list next to it is written', () => {
    expect(typedIntoBlock('- - -\n\n- a\n', 1)).toBe('- - -\n\n- Q a\n');
  });
});

describe('the plain text search reads', () => {
  it('does not put spaces around a link', () => {
    expect(plainTextOf(parseBodyToMdast('[[x]]#tag and a[[y]]b\n'))).toBe('[[x]]#tag and a[[y]]b');
  });
});

describe('a link whose name holds `<!--` (ADR-0020)', () => {
  it('is a bookmark, with the marker after it as its only comment', () => {
    const [block] = parseMarkdownBody('[[a<!--b]] <!-- atlas:bookmark -->\n').doc.content;
    expect(block?.type).toBe('bookmark');
    expect(block?.attrs?.['target']).toBe('a<!--b');
  });
});

describe('a code span and a link that would overlap', () => {
  const inEditor = (markdown: string): string[] => {
    const found: string[] = [];
    const visit = (node: EditorNode) => {
      if (node.type === 'wikiLink') found.push(String(node.attrs?.['target']));
      node.content?.forEach(visit);
    };
    parseMarkdownBody(markdown).doc.content.forEach(visit);
    return found;
  };
  const inIndex = (markdown: string): string[] =>
    splitWikiLinks(markdown).flatMap((piece) => (piece.kind === 'wikiLink' ? [piece.target] : []));

  it.each([
    ['the code span wins when it opens in the link and closes after it', 'a [[x`y]] b` c\n', []],
    ['the link stands when a code span opens and closes in it', 'a [[x`y`z]] b\n', ['x`y`z']],
    ['the link stands when its backtick closes nothing', 'a [[x`y]] b\n', ['x`y']],
    ['the link stands when its backtick is escaped', 'a [[x\\`y]] b` c\n', ['x\\`y']],
    [
      'the link stands when the backtick closes in another cell',
      '| h | h |\n| - | - |\n| [[x`y]] | b` |\n',
      ['x`y'],
    ],
  ])('%s, for the editor and the index alike', (_, markdown, expected) => {
    expect(inEditor(markdown)).toEqual(expected);
    expect(inIndex(markdown)).toEqual(expected);
  });
});
