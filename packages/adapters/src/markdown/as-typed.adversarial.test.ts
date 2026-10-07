import { afterEach, describe, expect, it, vi } from 'vitest';
import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkStringify, { type Options as StringifyOptions } from 'remark-stringify';
import type { Root } from 'mdast';
import type { EditorDocument, EditorMark, EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';
import { editorNodeToMdastBlock } from './editor-to-mdast.ts';
import './mdast-custom-nodes.ts';

/**
 * Adversarial checks on A21-01 (text saved as typed). The promise: after a
 * block is edited, the saved markdown reads back as exactly what the editor
 * held — no markup appears or disappears — and it reads no differently from
 * what remark's own, fully escaped, output would have.
 */

const text = (value: string, marks: readonly EditorMark['type'][] = []): EditorNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 && { marks: marks.map((type) => ({ type })) }),
});

const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });

/** A new note holding `blocks`, saved and read back. */
function saveAndReload(...blocks: EditorNode[]): {
  markdown: string;
  reread: readonly EditorNode[];
} {
  const doc: EditorDocument = { type: 'doc', content: blocks };
  const markdown = serializeMarkdownBody({ originalBody: '', parsed: parseMarkdownBody(''), doc });
  return { markdown, reread: parseMarkdownBody(markdown).doc.content };
}

const textOf = (node: EditorNode | undefined): string =>
  node?.text ?? (node?.content ?? []).map(textOf).join('');

const marksOn = (node: EditorNode | undefined, fragment: string): string[] =>
  (node?.content ?? [])
    .filter((child) => (child.text ?? '').includes(fragment))
    .flatMap((child) => (child.marks ?? []).map((mark) => mark.type));

describe('a web address typed as plain text, then saved', () => {
  it.each([
    ['underscores', 'See http://example.com/_private_ now'],
    ['square brackets', 'Docs at www.example.com/[v2] today'],
    ['an asterisk', 'See http://example.com/*.md files'],
    ['a tilde', 'Home is http://example.com/~julie today'],
    ['an ampersand entity', 'Query http://example.com/?a=1&amp;b=2 here'],
  ])('reads back with the same text when the address holds %s', (_label, typed) => {
    const { reread } = saveAndReload(paragraph(text(typed)));
    expect(textOf(reread[0])).toBe(typed);
  });

  it('keeps the bold around an address that a letter follows', () => {
    const { reread } = saveAndReload(
      paragraph(text('Visit '), text('http://example.com', ['bold']), text('today')),
    );
    expect(textOf(reread[0])).toBe('Visit http://example.comtoday');
    expect(marksOn(reread[0], 'example')).toContain('bold');
  });

  it("keeps the italics around a www address followed by 's", () => {
    const { reread } = saveAndReload(
      paragraph(text('The '), text('www.example.com', ['italic']), text("'s homepage")),
    );
    expect(textOf(reread[0])).toBe("The www.example.com's homepage");
    expect(marksOn(reread[0], 'example')).toContain('italic');
  });

  it('keeps inline code that directly follows an address', () => {
    const { reread } = saveAndReload(
      paragraph(text('Run http://example.com'), text('--help', ['code'])),
    );
    expect(marksOn(reread[0], '--help')).toEqual(['code']);
  });

  it('keeps the paragraph editable when an address is followed by <tag>', () => {
    const { reread } = saveAndReload(paragraph(text('Open http://example.com/<id> later')));
    expect(reread[0]?.type).toBe('paragraph');
    expect(textOf(reread[0])).toBe('Open http://example.com/<id> later');
  });
});

describe('a link wrapped over two lines inside a quote, whose paragraph is edited', () => {
  /** The note with its second block's paragraphs each given `' Later.'`, saved and read back. */
  function appendToQuote(markdown: string): EditorNode | undefined {
    const parsed = parseMarkdownBody(markdown);
    const appended = (node: EditorNode): EditorNode =>
      node.type === 'paragraph'
        ? { ...node, content: [...(node.content ?? []), text(' Later.')] }
        : { ...node, content: (node.content ?? []).map(appended) };
    const content = parsed.doc.content.map((node, index) => (index === 1 ? appended(node) : node));
    const saved = serializeMarkdownBody({
      originalBody: markdown,
      parsed,
      doc: { type: 'doc', content },
    });
    return parseMarkdownBody(saved).doc.content[1];
  }

  it.each([
    ['a blockquote', '> see [two\n> lines](https://example.com) here', 'blockquote'],
    ['a callout', '> [!note]\n> see [two\n> lines](https://example.com) here', 'callout'],
    // Images were kept as their own bytes before A21-01, so this one predates it.
    ['a blockquote, as an image', '> see ![two\n> lines](pic.png) here', 'blockquote'],
  ])('stays one paragraph in %s, with no quote nested inside it', (_label, quote, type) => {
    const reread = appendToQuote(`# Note\n\n${quote}\n\nEnd\n`);
    expect(reread?.type).toBe(type);
    expect(reread?.content?.map((child) => child.type)).toEqual(['paragraph']);
  });
});

/** Seeded, so every failing case can be replayed by its seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '*',
  '_',
  '~',
  '~~',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '&',
  '#',
  '\\',
  '`',
  '|',
  '!',
  '@',
  ':',
  'www.',
  'www.x.com',
  'http://',
  'http://a.b',
  'a@b.co',
  'julie@example.com',
  '&amp;',
  '&#35;',
  '&copy',
  '[^1]',
  '$',
  '$x$',
  '==',
  '%%',
  '<b>',
  '</b>',
  '<!-- c -->',
  '[[',
  ']]',
  '#x',
  '#x y#',
  ' ',
  ' ',
  'a',
  'word',
  'snake_case',
  '1.',
  '-',
  '+',
  '"',
  "'",
  '{',
  '}',
  '^',
  '.',
  'é',
  '😀',
  '[x]',
  '[foo]',
  '[foo]: /u',
];

function generatedDocument(seed: number): EditorDocument {
  const random = mulberry32(seed);
  const pick = <T>(options: readonly T[]): T => options[Math.floor(random() * options.length)]!;
  const words = () =>
    Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(PIECES)).join('');
  const marks = (): EditorMark['type'][] => {
    if (random() < 0.12) return ['code'];
    return (['bold', 'italic', 'strike'] as const).filter(() => random() < 0.2);
  };
  // Letters at each end keep the writer's end-of-block trimming out of the comparison.
  const inline = () =>
    Array.from({ length: 1 + Math.floor(random() * 4) }, () => text(`k${words()}k`, marks()));
  const para = () => paragraph(...inline());
  const item = (type: string, attrs?: Record<string, unknown>) => ({
    type,
    ...(attrs && { attrs }),
    content: [para()],
  });
  const block = (): EditorNode => {
    switch (pick(['p', 'p', 'h', 'ul', 'task', 'quote', 'callout', 'table'])) {
      case 'h':
        return {
          type: 'heading',
          attrs: { level: 1 + Math.floor(random() * 6) },
          content: inline(),
        };
      case 'ul':
        return { type: 'bulletList', content: [item('listItem'), item('listItem')] };
      case 'task':
        return { type: 'taskList', content: [item('taskItem', { checked: random() < 0.5 })] };
      case 'quote':
        return { type: 'blockquote', content: [para()] };
      case 'callout':
        return {
          type: 'callout',
          attrs: { kind: 'note', title: null, fold: null },
          content: [para()],
        };
      case 'table':
        return {
          type: 'table',
          attrs: { align: [null, null] },
          content: ['tableHeader', 'tableCell'].map((cell) => ({
            type: 'tableRow',
            content: [item(cell), item(cell)],
          })),
        };
      default:
        return para();
    }
  };
  return { type: 'doc', content: [block()] };
}

/** Remark's own output for a block, every guard in place: what the note said before A21-01. */
const verbatim = (node: { value: string }) => node.value;
const escapedEverywhere = unified()
  .use(remarkGfm, { tablePipeAlign: false })
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '*',
    strong: '*',
    fence: '`',
    fences: true,
    rule: '-',
    listItemIndent: 'one',
    handlers: {
      wikiLink: verbatim,
      calloutMarker: verbatim,
      verbatimInline: verbatim,
      tag: verbatim,
    } as unknown as StringifyOptions['handlers'],
  });

function remarkOutput(doc: EditorDocument): string {
  const root: Root = {
    type: 'root',
    children: doc.content.map((node) => editorNodeToMdastBlock(node) as never),
  };
  return escapedEverywhere.stringify(root);
}

/**
 * What a document reads as, character by character: each character with the
 * marks on it and the blocks around it. A link GFM makes of an address typed
 * as text is left out, since both writers make it — a mark that appears or
 * disappears anywhere else is not.
 */
function readingOf(nodes: readonly EditorNode[], path = ''): string[] {
  return nodes.flatMap((node, index) => {
    // Blocks are told apart by position; an inline atom is not, since an
    // autolink splits the text around it differently on each side.
    const at = `${path}/${node.type}${node.content === undefined ? '' : index}`;
    if (node.type !== 'text') {
      const attrs = Object.fromEntries(
        Object.entries(node.attrs ?? {}).filter(([key]) => key !== 'blockId'),
      );
      const inner = node.content === undefined ? [] : readingOf(mergedText(node.content), at);
      return [`${at} ${JSON.stringify(attrs)}`, ...inner];
    }
    const value = node.text ?? '';
    const marks = (node.marks ?? [])
      .filter((mark) => !isAutolinkOf(mark, value))
      .map((mark) => (mark.type === 'link' ? `link:${String(mark.attrs?.['href'])}` : mark.type))
      .sort()
      .join(',');
    return [...value].map((character) => `${path} ${character} [${marks}]`);
  });
}

function isAutolinkOf(mark: EditorMark, value: string): boolean {
  const href = String(mark.attrs?.['href'] ?? '');
  return mark.type === 'link' && [value, `mailto:${value}`, `http://${value}`].includes(href);
}

/** Adjacent text with the same marks as one run, so an autolink is seen whole. */
function mergedText(nodes: readonly EditorNode[]): EditorNode[] {
  const merged: EditorNode[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    const sameMarks = JSON.stringify(previous?.marks ?? []) === JSON.stringify(node.marks ?? []);
    if (previous?.type === 'text' && node.type === 'text' && sameMarks) {
      merged[merged.length - 1] = { ...previous, text: `${previous.text}${node.text}` };
    } else merged.push(node);
  }
  return merged;
}

describe('any document, saved as typed', () => {
  it('reads back as remark’s fully escaped output of it would (400 seeded documents)', () => {
    const differing: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const doc = generatedDocument(seed);
      const { markdown, reread } = saveAndReload(...doc.content);
      const expected = readingOf(parseMarkdownBody(remarkOutput(doc)).doc.content);
      const read = JSON.stringify(readingOf(reread));
      // Remark's own output misreads some documents, as main does (card A21-03):
      // `www.\~\~k` keeps its backslashes after an address. Writing such a one
      // as typed may only fix it — read as the document itself — never differ
      // some third way. Seeds 181, 282, 334 and 395 are such documents.
      const asTheDocument = read === JSON.stringify(readingOf(doc.content));
      if (read !== JSON.stringify(expected) && !asTheDocument) {
        differing.push(`seed ${seed}: ${JSON.stringify(markdown)}`);
      }
    }
    expect(differing.slice(0, 5), `${differing.length} of 400 documents read differently`).toEqual(
      [],
    );
  }, 60_000);
});

describe('the cost of saving a block', () => {
  const Processor = Object.getPrototypeOf(unified()) as { parse: (...args: never[]) => unknown };
  afterEach(() => vi.restoreAllMocks());

  /** How many times markdown is parsed to load and then save a note of one paragraph. */
  function parsesFor(escapes: number): number {
    const typed = Array.from({ length: escapes }, (_, index) => `snake_case_${index}`).join(' ');
    // One pair of literal stars, so not every escape can be dropped at once.
    const doc: EditorDocument = { type: 'doc', content: [paragraph(text(`${typed} *stars*`))] };
    const parse = vi.spyOn(Processor, 'parse');
    const markdown = serializeMarkdownBody({
      originalBody: '',
      parsed: parseMarkdownBody(''),
      doc,
    });
    parseMarkdownBody(markdown);
    const count = parse.mock.calls.length;
    parse.mockRestore();
    return count;
  }

  it('does not grow with the number of escapes in the block', () => {
    // Each parse reads the whole block, so parses that grow with its escapes
    // make saving — and opening — a long paragraph quadratic: 9 KB took 25 s.
    expect(parsesFor(40)).toBeLessThanOrEqual(2 * parsesFor(5));
  }, 60_000);
});
