import { afterEach, describe, expect, it, vi } from 'vitest';
import { unified } from 'unified';
import type { EditorDocument, EditorMark, EditorNode } from '@atlas/domain';
import { parseMarkdownBody, renderBlock, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * What a person typed stays as they typed it (A21-01). Remark escapes any
 * character that could start markup somewhere — `julie\@example.com`,
 * `snake\_case`, `\[x]` — and writes a bare link as `<https://…>`, so
 * editing one word of a paragraph used to rewrite the rest of it. An escape
 * is kept only where the text would otherwise read differently.
 */
const body = (paragraph: string, after = 'Last paragraph.') =>
  `# Note\n\n${paragraph}\n\n${after}\n`;

/** The document with its second block — the paragraph under test — changed by `edit`. */
function editParagraph(
  markdown: string,
  edit: (content: readonly EditorNode[]) => EditorNode[],
): string {
  const parsed = parseMarkdownBody(markdown);
  const content = [...parsed.doc.content];
  const paragraph = content[1]!;
  content[1] = { ...paragraph, content: edit(paragraph.content ?? []) };
  const doc: EditorDocument = { type: 'doc', content };
  return serializeMarkdownBody({ originalBody: markdown, parsed, doc });
}

const appendLater = (content: readonly EditorNode[]): EditorNode[] => [
  ...content,
  { type: 'text', text: ' Later.' },
];

const text = (value: string, marks?: EditorMark[]): EditorNode => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});

const linkTo = (href: string): EditorMark => ({ type: 'link', attrs: { href, title: null } });

const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });

describe('prose in a paragraph that is edited elsewhere', () => {
  it.each([
    ['an email', 'Mail julie@example.com now.'],
    ['an email with an underscore', 'Mail first_last@example.com now.'],
    ['an email in angle brackets', 'Mail <julie@example.com> now.'],
    ['a bare web address', 'See https://example.com/a_b now.'],
    ['a www address', 'See www.example.com now.'],
    ['a web address in angle brackets', 'See <https://example.com> now.'],
    ['an @ that is not an email', 'Ask x@y, or @julie.'],
    ['underscores inside words', 'The snake_case_name and my__dunder stay.'],
    ['underscores that close nothing', 'a_ b_c_ d'],
    ['a lone asterisk', 'Two * three is six.'],
    ['tildes that strike nothing', 'Approx ~5 miles.'],
    ['square brackets', 'Tick [x] and see [1].'],
    ['an ampersand that is not an entity', 'Rock &roll and AT&T.'],
    ['a less-than sign', 'If 1 <2 then.'],
    ['a colon after http', 'The word http: alone.'],
    ['a link written with its text', 'A [site](https://example.com) here.'],
  ])('keeps %s as written', (_label, prose) => {
    expect(editParagraph(body(prose), appendLater)).toBe(body(`${prose} Later.`));
  });

  it.each([
    ['asterisks that would make emphasis', 'Literal \\*stars\\* here.'],
    ['underscores that would make emphasis', 'Literal \\_under\\_ here.'],
    ['a hash that would open a heading', '\\# not a heading'],
    ['a dash that would open a list', '\\- not a list'],
    ['brackets that would make a link', 'Not \\[a link]\\(x).'],
    ['an entity written as text', 'The code \\&amp; itself.'],
    [
      'only what needs it, beside what does not',
      'Both \\*stars\\* and AT&T, [x] or julie@example.com.',
    ],
  ])('still escapes %s', (_label, prose) => {
    expect(editParagraph(body(prose), appendLater)).toBe(body(`${prose} Later.`));
  });

  it('escapes brackets a definition elsewhere in the note would turn into a link', () => {
    const markdown = body('Tick \\[x] now.', '[x]: https://example.com');
    expect(editParagraph(markdown, appendLater)).toBe(
      body('Tick \\[x] now. Later.', '[x]: https://example.com'),
    );
  });
});

describe('text typed into the editor', () => {
  it('writes an email as typed, not as julie\\@example.com', () => {
    expect(renderBlock(paragraph(text('Mail julie@example.com')))).toBe('Mail julie@example.com');
  });

  it('writes a web address as typed, not as http\\://', () => {
    expect(renderBlock(paragraph(text('See http://example.com')))).toBe('See http://example.com');
  });

  it.each([
    ['an email', 'julie@example.com', 'mailto:julie@example.com'],
    ['a web address', 'https://example.com', 'https://example.com'],
    ['a www address', 'www.example.com', 'http://www.example.com'],
  ])('writes %s the editor linked as typed, without angle brackets', (_label, typed, href) => {
    expect(renderBlock(paragraph(text('Mail '), text(typed, [linkTo(href)]), text(' now')))).toBe(
      `Mail ${typed} now`,
    );
  });

  it('writes an address the editor linked as typed, whatever else its link holds', () => {
    // What the editor's link mark carries besides its address, which markdown cannot say.
    const linked: EditorMark = {
      type: 'link',
      attrs: {
        href: 'mailto:julie@example.com',
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        class: null,
        title: null,
      },
    };
    expect(
      renderBlock(
        paragraph(text('Mail '), text('julie@example.com', [linked]), text(' or bob@example.com')),
      ),
    ).toBe('Mail julie@example.com or bob@example.com');
  });

  it('writes a link whose text is not its address in full', () => {
    expect(
      renderBlock(paragraph(text('Mail '), text('Julie', [linkTo('mailto:julie@example.com')]))),
    ).toBe('Mail [Julie](mailto:julie@example.com)');
  });

  it('still escapes text that would otherwise become markup', () => {
    expect(renderBlock(paragraph(text('*stars* and [x](y) and snake_case')))).toBe(
      '\\*stars\\* and \\[x]\\(y) and snake_case',
    );
  });
});

describe('a link picked at the end of a block', () => {
  const link: EditorNode = {
    type: 'wikiLink',
    attrs: { target: 'Name', heading: null, alias: null },
  };
  // What both pickers insert: the link, then a space to type on after.
  const picked = [text('See '), link, text(' ')];

  it.each([
    ['a paragraph', paragraph(...picked), 'See [[Name]]'],
    ['a heading', { type: 'heading', attrs: { level: 2 }, content: picked }, '## See [[Name]]'],
    [
      'a list item',
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(...picked)] }] },
      '- See [[Name]]',
    ],
    [
      'a table cell',
      {
        type: 'table',
        attrs: { align: [null] },
        content: [
          { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(...picked)] }] },
        ],
      },
      '| See [[Name]] |\n| - |',
    ],
  ] as const)('is written without the space in %s', (_label, node, expected) => {
    expect(renderBlock(node as EditorNode)).toBe(expected);
  });
});

describe('the cost of text saved as typed', () => {
  const Processor = Object.getPrototypeOf(unified()) as { parse: (...args: never[]) => unknown };
  afterEach(() => vi.restoreAllMocks());

  /** How many times markdown is parsed while `run` runs. */
  function parsesDuring<T>(run: () => T): { parses: number; result: T } {
    const parse = vi.spyOn(Processor, 'parse');
    const result = run();
    const parses = parse.mock.calls.length;
    parse.mockRestore();
    return { parses, result };
  }

  // Text remark escapes in several ways, many times over, with a definition
  // that makes one pair of brackets a link: over 9 KB in one paragraph.
  const long = Array.from(
    { length: 220 },
    (_, index) => `AT&T \\[x] \\*not\\* julie@example.com ${index}_a_ `,
  )
    .join('')
    .trimEnd();
  const note = body(long, '[x]: https://example.com');
  const textOf = (node: EditorNode | undefined): string =>
    node?.text ?? (node?.content ?? []).map(textOf).join('');

  it('reads a note with one parse, however much of its text is escaped', () => {
    expect(long.length).toBeGreaterThan(9000);
    expect(parsesDuring(() => parseMarkdownBody(note)).parses).toBe(1);
  }, 60_000);

  it('saves an edited 9 KB paragraph with a handful of parses, not one per escape', () => {
    const parsed = parseMarkdownBody(note);
    const doc: EditorDocument = {
      type: 'doc',
      content: parsed.doc.content.map((node, index) =>
        index === 1 ? { ...node, content: appendLater(node.content ?? []) } : node,
      ),
    };
    const { parses, result: saved } = parsesDuring(() =>
      serializeMarkdownBody({ originalBody: note, parsed, doc }),
    );
    // Parsing is what made saving slow — 9 KB once took 25 s — so it is counted
    // rather than timed: a handful of parses of 9 KB takes well under 100 ms.
    expect(parses).toBeLessThanOrEqual(8);
    const reread = parseMarkdownBody(saved).doc.content[1];
    expect(textOf(reread)).toBe(`${textOf(parsed.doc.content[1])} Later.`);
    expect(saved).toContain('AT&T \\[x] \\*not\\* julie@example.com 0_a_ AT&T');
    // Counted, not timed, so a loaded machine may take its time.
  }, 60_000);
});
