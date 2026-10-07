import { describe, expect, it } from 'vitest';
import { noteTags, splitFrontmatter, TAGS_KEY, type EditorDocument } from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';
import {
  parseMarkdownBody,
  RAW_BLOCK,
  renderBlock,
  serializeMarkdownBody,
} from './markdown-blocks.ts';

/**
 * Tags are text to the editor, and remark escapes a `#` that opens a line —
 * `#idea` would come back `\#idea`, no longer a tag — so the serializer writes
 * each one verbatim (ADR-0004). Every block here is written back exactly as
 * it was, whether or not it is the block being edited.
 */
const TAG_BLOCKS: Array<[label: string, markdown: string]> = [
  ['a tag opening a paragraph', '#idea at the start'],
  ['a tag alone', '#idea'],
  ['a tag mid-sentence', 'Some #idea here.'],
  ['a multi-word tag', '#tag me# and more'],
  ['a closed single word', '#word# stays closed'],
  ['a nested tag', '#para/resource then text'],
  ['adjacent punctuation', '(#aside), #end. #bang! #ask?'],
  ['a tag on a continuation line', 'First line\n#second line'],
  ['a heading with a tag', '## Plans #draft'],
  ['a bullet list', '- #one\n- #two three#\n- plain'],
  ['a task list', '- [ ] #todo item\n- [x] #done'],
  ['an ordered list', '1. #first\n2. second'],
  ['a blockquote', '> #quoted tag\n> more'],
  ['a callout', '> [!note] Title\n> #inside the callout'],
  ['a table', '| #a | b |\n| - | - |\n| #c | d |'],
  ['emphasis around a tag', '*#emph* and **#strong**'],
  ['a tag beside a wiki link', '[[Page#Heading]] #real'],
  ['a tag in link text', '[see #this](https://example.com)'],
  ['inline code', '`#not-a-tag` #tag'],
  ['a unicode tag', '#café #日本/東京'],
];

/**
 * Blocks with a `#` that is not a tag. Untouched, they keep their bytes; an
 * edited one is written the way remark writes it (`<url>`, `\#123`), as before
 * tags existed.
 */
const NOT_TAG_BLOCKS: Array<[label: string, markdown: string]> = [
  ['a URL fragment', 'https://example.com/#frag #tag'],
  ['a number', '#123 is an issue'],
];

const body = (block: string) => `# Title\n\n${block}\n\nLast paragraph.\n`;

describe('a note with tags', () => {
  it.each([...TAG_BLOCKS, ...NOT_TAG_BLOCKS])(
    'keeps %s byte-identical when nothing is edited',
    (_label, block) => {
      const original = body(block);
      const parsed = parseMarkdownBody(original);
      expect(serializeMarkdownBody({ originalBody: original, parsed, doc: parsed.doc })).toBe(
        original,
      );
    },
  );

  it.each([...TAG_BLOCKS, ...NOT_TAG_BLOCKS])(
    'keeps %s byte-identical when another block is edited',
    (_label, block) => {
      const original = body(block);
      const parsed = parseMarkdownBody(original);
      const content = [...parsed.doc.content];
      const last = content.length - 1;
      content[last] = { ...content[last]!, content: [{ type: 'text', text: 'Edited.' }] };
      const saved = serializeMarkdownBody({
        originalBody: original,
        parsed,
        doc: { type: 'doc', content },
      });
      expect(saved).toBe(`# Title\n\n${block}\n\nEdited.\n`);
    },
  );

  it.each(TAG_BLOCKS)('writes %s back as it was when its own block is edited', (_label, block) => {
    const parsed = parseMarkdownBody(block);
    // What an edited block is written as: its node, serialized afresh.
    expect(parsed.doc.content.map((node) => renderBlock(node)).join('\n\n')).toBe(block);
  });
});

describe('a tag typed into the editor', () => {
  const save = (text: string) => {
    const doc: EditorDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
    return serializeMarkdownBody({ originalBody: '', parsed: parseMarkdownBody(''), doc });
  };

  it('is written unescaped at the start of a line', () => {
    expect(save('#idea at the start')).toBe('#idea at the start\n');
  });

  it('is written unescaped when it has several words', () => {
    expect(save('#tag me# first')).toBe('#tag me# first\n');
  });

  it('leaves a # that is not a tag to be escaped as before', () => {
    expect(save('# not a heading')).toBe('\\# not a heading\n');
  });
});

describe('a # the note escaped', () => {
  it.each([
    ['a backslash', '\\#idea is not a tag'],
    ['an entity', '&#35;idea is not a tag'],
    ['an escape inside the word', '#tag\\_x'],
  ])('keeps a block with %s as it is written, so it never becomes a tag', (_label, block) => {
    const parsed = parseMarkdownBody(block);
    expect(parsed.doc.content[0]?.type).toBe(RAW_BLOCK);
    expect(renderBlock(parsed.doc.content[0]!)).toBe(block);
  });

  it('still edits a block whose escapes are elsewhere', () => {
    const parsed = parseMarkdownBody('#idea costs \\*5');
    expect(parsed.doc.content[0]?.type).toBe('paragraph');
  });
});

describe('the tags a note has, as the index reads them', () => {
  const tagsOf = (text: string) => {
    const document = splitFrontmatter(text);
    return noteTags({
      tagsProperty: remarkMarkdown.frontmatterProperties(document.frontmatter)[TAGS_KEY],
      body: document.body,
      ranges: remarkMarkdown.textRanges(document.body),
    }).map((tag) => tag.name);
  };

  it('reads the tags property and the prose, in order', () => {
    const note = '---\ntags: [project, "#tag me#"]\n---\n# Title #draft\n\nText #idea.\n';
    expect(tagsOf(note)).toEqual(['project', 'tag me', 'draft', 'idea']);
  });

  it('never reads a tag in code, a link, HTML or a heading marker', () => {
    const body = [
      '# Heading',
      '',
      '```css',
      'color: #fff; #block',
      '```',
      '',
      '    #indented code',
      '',
      '<div>#html</div>',
      '',
      'Inline `#code`, [a #link](https://x.com/#frag), [[Page#Heading]], ![[P#^b]] and #real.',
      '',
    ].join('\n');
    expect(tagsOf(body)).toEqual(['real']);
  });

  it('reads a tag in a list, a quote, a callout and a table', () => {
    const body = '- #one\n\n> #two\n\n> [!note]\n> #three\n\n| #four |\n| - |\n| #five |\n';
    expect(tagsOf(body)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });
});
