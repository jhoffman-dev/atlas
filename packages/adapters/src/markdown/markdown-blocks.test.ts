import { describe, expect, it } from 'vitest';
import { blockIdOf, type EditorDocument, type EditorNode } from '@atlas/domain';
import {
  parseMarkdownBody,
  renderBlock,
  serializeMarkdownBody,
  RAW_BLOCK,
} from './markdown-blocks.ts';

/** Saves the document exactly as it was loaded — the no-op round trip. */
const roundTrip = (body: string): string => {
  const parsed = parseMarkdownBody(body);
  return serializeMarkdownBody({ originalBody: body, parsed, doc: parsed.doc });
};

const CORPUS: Array<[label: string, markdown: string]> = [
  ['empty', ''],
  ['one paragraph', 'Just some text.\n'],
  ['two paragraphs', 'One.\n\nTwo.\n'],
  ['atx headings', '# One\n\n## Two\n\n### Three\n'],
  ['setext heading', 'Title\n=====\n\nBody.\n'],
  ['bullet list with *', '* one\n* two\n'],
  ['bullet list with -', '- one\n- two\n'],
  ['bullet list with +', '+ one\n+ two\n'],
  ['ordered list', '1. one\n2. two\n'],
  ['ordered list starting at 5', '5. five\n6. six\n'],
  ['task list', '- [ ] todo\n- [x] done\n'],
  ['nested list', '- one\n  - nested\n- two\n'],
  ['fenced code', '```ts\nconst a = 1;\n```\n'],
  ['fenced code without language', '```\nplain\n```\n'],
  ['indented code', '    indented code\n'],
  ['blockquote', '> quoted\n'],
  ['thematic break', 'a\n\n---\n\nb\n'],
  ['emphasis with underscores', 'some _emphasis_ here\n'],
  ['emphasis with asterisks', 'some *emphasis* here\n'],
  ['strong', 'some **strong** here\n'],
  ['inline code', 'a `code` span\n'],
  ['strikethrough', '~~gone~~\n'],
  ['link', 'a [link](https://example.com) here\n'],
  ['link with title', 'a [link](https://example.com "T") here\n'],
  ['autolink', '<https://example.com>\n'],
  ['image', '![alt](image.png)\n'],
  ['html block', '<div class="x">raw</div>\n'],
  ['table', '| a | b |\n| - | - |\n| 1 | 2 |\n'],
  ['footnote', 'text[^1]\n\n[^1]: note\n'],
  ['wikilink', 'see [[Another Note]] for more\n'],
  ['tag', 'tagged #project/atlas here\n'],
  ['hard wrapped paragraph', 'one line\nsecond line\nthird line\n'],
  ['trailing blank lines', 'text\n\n\n'],
  ['no trailing newline', 'text'],
  ['unicode', 'año — 日本語 🎉\n'],
  ['escaped characters', 'a \\* not a bullet\n'],
  ['block id on a paragraph', 'The plan. ^f3k9x2\n'],
  ['block ids on list items', '* Tent  ^i1\n  *  Pegs ^i2\n* Stove\n'],
  ['block id on a table', '| a | b |\n|---|---|\n| 1 | 2 |\n\n^t1\n'],
  ['block id on a quote, with CRLF', '> said\r\n\r\n^q1\r\n'],
  ['caret that is no id', 'x^2 and \\^a1 and ^ alone\n'],
  ['id alone after a paragraph', 'Text.\n\n^a1\n'],
  ['shown block', 'Before.\n\n![[Plans#^f3k9x2]]\n\n![[Plans#Packing list|packing]]\n'],
  ['embed in a sentence', 'See ![[Plans#^f3k9x2]] here.\n'],
  [
    'mixed document',
    '# Title\n\nIntro _text_.\n\n- [ ] one\n- [x] two\n\n```js\nx();\n```\n\n> quote\n',
  ],
];

describe('a document saved without being edited is byte-identical', () => {
  it.each(CORPUS)('%s', (_label, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe('parseMarkdownBody', () => {
  it('gives every block a source range covering the original', () => {
    const body = '# Title\n\nBody text.\n';
    const { blocks } = parseMarkdownBody(body);
    expect(blocks).toHaveLength(2);
    expect(body.slice(blocks[0]!.start, blocks[0]!.end)).toBe('# Title');
    expect(body.slice(blocks[1]!.start, blocks[1]!.end)).toBe('Body text.');
  });

  it('tags each editor node with its block id', () => {
    const { doc } = parseMarkdownBody('one\n\ntwo\n');
    expect(doc.content.map(blockIdOf)).toEqual(['b0', 'b1']);
  });

  it('converts a heading into a heading node', () => {
    const { doc } = parseMarkdownBody('## Two\n');
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  it('converts a task list into task items with their checked state', () => {
    const { doc } = parseMarkdownBody('- [ ] todo\n- [x] done\n');
    const list = doc.content[0];
    expect(list?.type).toBe('taskList');
    expect(list?.content?.map((item) => item.attrs?.['checked'])).toEqual([false, true]);
  });

  it('turns a table into an editable table', () => {
    const { doc } = parseMarkdownBody('| a | b |\n| - | - |\n| 1 | 2 |\n');
    const table = doc.content[0];
    expect(table?.type).toBe('table');
    expect(table?.content).toHaveLength(2);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(table?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
  });

  it.each([
    ['html', '<div>x</div>\n'],
    ['footnote definition', '[^1]: note\n'],
  ])('keeps %s as a raw block', (_label, markdown) => {
    expect(parseMarkdownBody(markdown).doc.content[0]?.type).toBe(RAW_BLOCK);
  });

  it('turns an image into an image node', () => {
    const { doc } = parseMarkdownBody('![alt text](images/pic.png "A title")\n');
    expect(doc.content[0]?.content?.[0]).toEqual({
      type: 'image',
      attrs: { src: 'images/pic.png', alt: 'alt text', title: 'A title' },
    });
  });

  it.each([
    ['plain', '![alt](pic.png)'],
    ['with a title', '![alt](pic.png "A title")'],
    ['no alt text', '![](pic.png)'],
    ['inline with text', 'before ![alt](pic.png) after'],
    ['external', '![alt](https://example.com/pic.png)'],
  ])('round-trips an image %s', (_label, markdown) => {
    const { doc } = parseMarkdownBody(`${markdown}\n`);
    expect(renderBlock(doc.content[0]!)).toBe(markdown);
  });
});

describe('renderBlock', () => {
  it('writes a raw block back exactly as it came in', () => {
    const node: EditorNode = { type: RAW_BLOCK, attrs: { markdown: '| a |\n| - |' } };
    expect(renderBlock(node)).toBe('| a |\n| - |');
  });

  it('escapes text that would otherwise become markup', () => {
    const node: EditorNode = {
      type: 'paragraph',
      content: [{ type: 'text', text: '* not a list' }],
    };
    expect(renderBlock(node)).toBe('\\* not a list');
  });

  it('merges adjacent text sharing a mark into one run', () => {
    const node: EditorNode = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      ],
    };
    expect(renderBlock(node)).toBe('**ab**');
  });

  it('nests marks rather than emitting them twice', () => {
    const node: EditorNode = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }] }],
    };
    expect(renderBlock(node)).toBe('***x***');
  });
});

describe('whitespace typed at the end of a block', () => {
  const text = (value: string, marks?: { type: string }[]): EditorNode => ({
    type: 'text',
    text: value,
    ...(marks && { marks }),
  });

  it('is trimmed from a heading rather than written as &#x20;', () => {
    const node: EditorNode = {
      type: 'heading',
      attrs: { level: 1 },
      content: [text('This is a test ')],
    };
    expect(renderBlock(node)).toBe('# This is a test');
  });

  it('is trimmed from a paragraph, tabs and all', () => {
    const node: EditorNode = { type: 'paragraph', content: [text('Ends here \t ')] };
    expect(renderBlock(node)).toBe('Ends here');
  });

  it('is trimmed inside the mark the block ends on', () => {
    const node: EditorNode = {
      type: 'paragraph',
      content: [text('some '), text('bold ', [{ type: 'bold' }])],
    };
    expect(renderBlock(node)).toBe('some **bold**');
  });

  it('is trimmed from a paragraph inside a list item', () => {
    const node: EditorNode = {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [text('one ')] }],
        },
      ],
    };
    expect(renderBlock(node)).toBe('- one');
  });

  it('leaves spaces between words and at the start of a run alone', () => {
    const node: EditorNode = {
      type: 'paragraph',
      content: [text('a  b '), text('c', [{ type: 'bold' }])],
    };
    expect(renderBlock(node)).toBe('a  b **c**');
  });

  it('never touches a block that was not edited', () => {
    const body = '# Kept as it was \n\nSecond.\n';
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = {
      type: 'doc',
      content: [parsed.doc.content[0]!, { type: 'paragraph', content: [text('Edited ')] }],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe(
      '# Kept as it was \n\nEdited\n',
    );
  });
});

describe('editing one block leaves the others untouched', () => {
  const body = '# Title\n\nFirst *paragraph*.\n\n- one\n- two\n\n> quoted\n';

  const edit = (transform: (nodes: EditorNode[]) => EditorNode[]): string => {
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = { type: 'doc', content: transform([...parsed.doc.content]) };
    return serializeMarkdownBody({ originalBody: body, parsed, doc });
  };

  it('rewrites only the edited paragraph', () => {
    const result = edit((nodes) => {
      nodes[1] = {
        ...nodes[1]!,
        content: [{ type: 'text', text: 'Replaced.' }],
      };
      return nodes;
    });
    expect(result).toBe('# Title\n\nReplaced.\n\n- one\n- two\n\n> quoted\n');
  });

  it('keeps the list written with its original bullet characters', () => {
    const starred = '* one\n* two\n\nAfter.\n';
    const parsed = parseMarkdownBody(starred);
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        parsed.doc.content[0]!,
        { ...parsed.doc.content[1]!, content: [{ type: 'text', text: 'Changed.' }] },
      ],
    };
    const result = serializeMarkdownBody({ originalBody: starred, parsed, doc });
    // The untouched list keeps `*` even though new lists would be written with `-`.
    expect(result).toBe('* one\n* two\n\nChanged.\n');
  });

  it('inserts a new block without disturbing its neighbours', () => {
    const result = edit((nodes) => [
      nodes[0]!,
      { type: 'paragraph', content: [{ type: 'text', text: 'Inserted.' }] },
      ...nodes.slice(1),
    ]);
    expect(result).toBe('# Title\n\nInserted.\n\nFirst *paragraph*.\n\n- one\n- two\n\n> quoted\n');
  });

  it('removes a block and closes the gap', () => {
    const result = edit((nodes) => nodes.filter((_, index) => index !== 1));
    expect(result).toBe('# Title\n\n- one\n- two\n\n> quoted\n');
  });

  it('handles every block being deleted', () => {
    const result = edit(() => []);
    expect(result).toBe('');
  });
});

describe('blocks that serialize to nothing', () => {
  it('drops the empty paragraph the editor keeps after an atom block', () => {
    const body = '| a | b |\n| - | - |\n';
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = {
      type: 'doc',
      content: [...parsed.doc.content, { type: 'paragraph' }],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe(body);
  });

  it('drops a paragraph the user emptied out', () => {
    const body = 'one\n\ntwo\n';
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = {
      type: 'doc',
      content: [{ ...parsed.doc.content[0]!, content: [] }, parsed.doc.content[1]!],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe('two\n');
  });
});

describe('wiki links', () => {
  it('becomes a node rather than staying as text', () => {
    const { doc } = parseMarkdownBody('see [[Another Note]] for more\n');
    expect(doc.content[0]?.content).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'wikiLink', attrs: { target: 'Another Note', heading: null, alias: null } },
      { type: 'text', text: ' for more' },
    ]);
  });

  it.each([
    ['plain', 'see [[Note]] here'],
    ['with an alias', 'see [[Note|shown]] here'],
    ['with a heading', 'see [[Note#Section]] here'],
    ['with heading and alias', 'see [[Note#Section|shown]] here'],
    ['two in one line', '[[A]] and [[B]]'],
    ['inside emphasis', 'an *[[Italic Link]]* here'],
    ['at the very start', '[[Note]] leads'],
  ])('survives being re-serialized (%s)', (_label, markdown) => {
    // renderBlock is what runs when the user edits the block, so this is the
    // path where escaping would corrupt the link.
    const { doc } = parseMarkdownBody(`${markdown}\n`);
    expect(renderBlock(doc.content[0]!)).toBe(markdown);
  });

  it('keeps links intact when the paragraph around them is edited', () => {
    const body = '# Title\n\nsee [[Another Note]] for more\n';
    const parsed = parseMarkdownBody(body);
    const paragraph = parsed.doc.content[1]!;
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        parsed.doc.content[0]!,
        {
          ...paragraph,
          content: [...(paragraph.content ?? []), { type: 'text', text: ' — edited' }],
        },
      ],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe(
      '# Title\n\nsee [[Another Note]] for more — edited\n',
    );
  });

  it('leaves text that only looks like a link alone', () => {
    const { doc } = parseMarkdownBody('an [[unclosed link\n');
    expect(doc.content[0]?.content?.[0]).toMatchObject({ type: 'text' });
  });
});

describe('tables', () => {
  it('keeps column alignment through a round trip', () => {
    const body = '| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n';
    const parsed = parseMarkdownBody(body);
    expect(parsed.doc.content[0]?.attrs?.['align']).toEqual(['left', 'center', 'right']);
    expect(renderBlock(parsed.doc.content[0]!)).toBe(body.trimEnd());
  });

  it('keeps cell formatting', () => {
    const body = '| a | b |\n| - | - |\n| **bold** | [link](x) |\n';
    const { doc } = parseMarkdownBody(body);
    expect(renderBlock(doc.content[0]!)).toContain('**bold**');
    expect(renderBlock(doc.content[0]!)).toContain('[link](x)');
  });

  it('keeps a wiki link inside a cell', () => {
    const body = '| a |\n| - |\n| [[Note]] |\n';
    const { doc } = parseMarkdownBody(body);
    expect(renderBlock(doc.content[0]!)).toContain('[[Note]]');
  });

  it('handles an empty cell', () => {
    const body = '| a | b |\n| - | - |\n| 1 |  |\n';
    const { doc } = parseMarkdownBody(body);
    expect(doc.content[0]?.type).toBe('table');
    expect(renderBlock(doc.content[0]!)).toContain('| 1 |');
  });

  it('is left untouched when another block is edited', () => {
    const body = 'Intro.\n\n| a | b |\n| :- | -: |\n| 1 | 2 |\n';
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        { ...parsed.doc.content[0]!, content: [{ type: 'text', text: 'Edited.' }] },
        parsed.doc.content[1]!,
      ],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe(
      'Edited.\n\n| a | b |\n| :- | -: |\n| 1 | 2 |\n',
    );
  });
});

describe('callouts', () => {
  it('recognises a callout blockquote', () => {
    const { doc } = parseMarkdownBody('> [!warning] Be careful\n> body text\n');
    expect(doc.content[0]).toMatchObject({
      type: 'callout',
      attrs: { kind: 'warning', title: 'Be careful', fold: null },
    });
  });

  it('keeps the body as editable blocks', () => {
    const { doc } = parseMarkdownBody('> [!note]\n> body text\n');
    expect(doc.content[0]?.content?.[0]).toMatchObject({ type: 'paragraph' });
  });

  it('leaves an ordinary blockquote alone', () => {
    const { doc } = parseMarkdownBody('> just a quote\n');
    expect(doc.content[0]?.type).toBe('blockquote');
  });

  it.each([
    ['bare', '> [!note]'],
    ['with a title', '> [!warning] Be careful'],
    ['with a body', '> [!note] Title\n> body text'],
    ['folded', '> [!tip]- Folded'],
    ['with a list inside', '> [!note] Title\n>\n> - one\n> - two'],
  ])('round-trips %s', (_label, markdown) => {
    const { doc } = parseMarkdownBody(`${markdown}\n`);
    expect(renderBlock(doc.content[0]!)).toBe(markdown);
  });

  it('keeps a wiki link in the body', () => {
    const { doc } = parseMarkdownBody('> [!note] Title\n> see [[Another]]\n');
    expect(renderBlock(doc.content[0]!)).toContain('[[Another]]');
  });
});

describe('whitespace before the first block', () => {
  it('survives an edit to the first block', () => {
    // What sits between the frontmatter and the first paragraph.
    const body = '\nBody text.\n';
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        { ...parsed.doc.content[0]!, content: [{ type: 'text', text: 'Body text. More.' }] },
      ],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe('\nBody text. More.\n');
  });

  it('survives when a block is inserted above it', () => {
    const body = '\nBody text.\n';
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'New first.' }] },
        parsed.doc.content[0]!,
      ],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe(
      '\nNew first.\n\nBody text.\n',
    );
  });

  it('keeps several blank lines', () => {
    const body = '\n\n\nBody text.\n';
    const parsed = parseMarkdownBody(body);
    const doc: EditorDocument = {
      type: 'doc',
      content: [{ ...parsed.doc.content[0]!, content: [{ type: 'text', text: 'Changed.' }] }],
    };
    expect(serializeMarkdownBody({ originalBody: body, parsed, doc })).toBe('\n\n\nChanged.\n');
  });
});
