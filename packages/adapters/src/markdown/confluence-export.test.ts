/**
 * Exporting a note for Confluence (P32-07) through the real markdown reader
 * and writer: what the page's markdown says, byte for byte, and what the
 * export says it left out.
 */
import { describe, expect, it } from 'vitest';
import type { Nodes, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { createVaultPath } from '@atlas/domain';
import { exportNoteForConfluence, fakeIndexPort, fakeVaultFs } from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const FILES: Record<string, string> = {
  'Plans.md': [
    '---',
    'title: Summer plans',
    '---',
    '',
    '# Plans',
    '',
    'Pack light. ^p1',
    '',
    '## Packing',
    '',
    '- [ ] Tent ^t1',
    '- [x] Stove from [[Larkspur Payroll]]',
    '',
    '## Later',
    '',
    'Nothing.',
    '',
  ].join('\n'),
  'People/Mara Quill.md': '# Mara\n',
  'Companies/Larkspur Payroll.md': '---\ntitle: Larkspur Payroll Ltd\n---\n',
  'Private.md': 'Kept back. ^k1\n',
  'Agenda/1. Kickoff.md': 'Kick off.\n',
  'Sources.md': '# Sources\n\n## Cited\n\nTheir claim.[^1]\n\n[^1]: Their source.\n\n## End\n',
};

const HERE = 'Meetings/Weekly sync.md';

function exported(text: string, readable = [...Object.keys(FILES), HERE]) {
  const read: string[] = [];
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        read.push(path);
        const file = FILES[path];
        return file === undefined ? [] : [{ path, text: file, modified: 1, size: file.length }];
      }),
  });
  const result = exportNoteForConfluence({
    fs,
    markdown: remarkMarkdown,
    index: fakeIndexPort(),
    note: { path: createVaultPath(HERE), text },
    notePaths: readable.map(createVaultPath),
  });
  return { result, read };
}

describe('a note exported for Confluence', () => {
  it('reads as the note does: links as words, shown blocks quoted, callouts as quotes', async () => {
    const note = [
      '---',
      'type: meeting',
      'status: done',
      '---',
      '',
      '# Weekly sync',
      '',
      'Met with [[mara quill]] and [[Tobias Fenn|Tobias]] about [[Plans#Packing]]. ^m1',
      '',
      '> [!warning]- Mind [[Plans]]',
      '> Ship *after* review.',
      '',
      '![[Plans#^p1]]',
      '',
      '![[Plans#Packing]]',
      '',
      '![[Gone#^x1]]',
      '',
      '- [ ] Call [[mara quill]] ^a1',
      '- [x] Book room',
      '',
      'A footnote.[^1] And [[Plans]]. <!-- private -->',
      '',
      '[^1]: The note.',
      '',
      '![map](attachments/map.png) and ![web](https://example.com/w.png)',
      '',
      '```',
      '[[not a link]] ^c1',
      '```',
      '',
    ].join('\n');

    const { title, markdown, dropped } = await exported(note).result;

    expect(title).toBe('Weekly sync');
    expect(markdown).toBe(
      [
        '# Weekly sync',
        '',
        'Met with Mara Quill and Tobias about Summer plans › Packing.',
        '',
        '> **Warning:** Mind Summer plans',
        '>',
        '> Ship *after* review.',
        '',
        '> *From Summer plans*',
        '>',
        '> Pack light.',
        '',
        '> *From Summer plans*',
        '>',
        '> ## Packing',
        '>',
        '> - [ ] Tent',
        '> - [x] Stove from Larkspur Payroll Ltd',
        '',
        '[Not found: Gone]',
        '',
        '- [ ] Call Mara Quill',
        '- [x] Book room',
        '',
        'A footnote.[^1] And Summer plans. ',
        '',
        '[^1]: The note.',
        '',
        '[Image: map] and ![web](https://example.com/w.png)',
        '',
        '```',
        '[[not a link]] ^c1',
        '```',
        '',
      ].join('\n'),
    );
    expect(dropped).toEqual([
      { kind: 'property', items: ['type', 'status'] },
      {
        kind: 'link',
        items: [
          '[[mara quill]]',
          '[[Tobias Fenn|Tobias]]',
          '[[Plans#Packing]]',
          '[[Plans]]',
          '[[Larkspur Payroll]]',
        ],
      },
      { kind: 'missing-embed', items: ['![[Gone#^x1]]'] },
      { kind: 'image', items: ['attachments/map.png'] },
      { kind: 'block-id', items: ['m1', 'p1', 't1', 'a1'] },
      { kind: 'comment', items: ['<!-- private -->'] },
      { kind: 'callout-fold', items: ['[!warning]-'] },
    ]);
  });

  it('has tables, bookmarks, embeds of files and local links as words, and says so', async () => {
    const note = [
      '---',
      'type: [unclosed',
      '---',
      '',
      '| Who | Note |',
      '| --- | --- |',
      '| [[mara quill\\|Mara]] | [[Plans#Later]] |',
      '',
      '[[Plans]] <!-- atlas:bookmark -->',
      '',
      'See ![[diagram.png]] and [the doc](Docs/Spec.md) and [[#Later]].',
      '',
      '- Item',
      '  > [!note] Inside',
      '  > body',
      '',
      '## Heading ^h1',
      '',
      '<!-- alone -->',
      '',
      'Text with <kbd>x</kbd> ^r1',
      '',
    ].join('\n');

    const { markdown, dropped } = await exported(note).result;

    expect(markdown).toBe(
      [
        '| Who | Note |',
        '| - | - |',
        '| Mara | Summer plans › Later |',
        '',
        'Summer plans',
        '',
        'See diagram.png and the doc and Later.',
        '',
        '- Item',
        '  > **Note:** Inside',
        '  >',
        '  > body',
        '',
        '## Heading',
        '',
        'Text with <kbd>x</kbd> ^r1',
        '',
      ].join('\n'),
    );
    expect(dropped).toEqual([
      { kind: 'property', items: ['(frontmatter Atlas cannot read)'] },
      {
        kind: 'link',
        items: [
          '[[mara quill|Mara]]',
          '[[Plans#Later]]',
          '[[Plans]]',
          'Docs/Spec.md',
          '[[#Later]]',
        ],
      },
      { kind: 'embed', items: ['![[diagram.png]]'] },
      { kind: 'block-id', items: ['h1'] },
      { kind: 'comment', items: ['<!-- alone -->'] },
    ]);
  });

  it('reads nothing from a note outside those it may read', async () => {
    const note = 'See [[Private]] and [[Plans]].\n\n![[Private#^k1]]\n';
    const { result, read } = exported(note, [HERE, 'Plans.md']);

    const { markdown, dropped } = await result;

    expect(markdown).toBe('See Private and Summer plans.\n\n[Not found: Private]\n');
    expect(dropped).toContainEqual({ kind: 'missing-embed', items: ['![[Private#^k1]]'] });
    expect(read).toEqual(['Plans.md']);
  });
});

/** The page's markdown as a GFM reader sees it: its top-level blocks. */
const blocksOf = (markdown: string): RootContent[] =>
  unified().use(remarkParse).use(remarkGfm).parse(markdown).children;

describe('a note exported for Confluence, attacked (P32-07)', () => {
  it('names an image or a note path in a block it cannot model, as it does in any other', async () => {
    const note =
      'See the map[^1] ![map](attachments/map.png) and [spec](Docs/Spec.md).\n\n[^1]: Drawn.\n';

    const { markdown, dropped } = await exported(note).result;

    expect(dropped).toContainEqual({ kind: 'image', items: ['attachments/map.png'] });
    expect(dropped).toContainEqual({ kind: 'link', items: ['Docs/Spec.md'] });
    expect(markdown).not.toContain('](attachments/map.png)');
  });

  it('leaves off the page a comment that is never closed, and names it', async () => {
    const note = 'Intro\n\n<!-- draft, not for sharing\n\nThe plan is secret.\n\nSo is this.\n';

    const { markdown, dropped } = await exported(note).result;

    expect(markdown).toContain('Intro');
    expect(markdown).not.toContain('The plan is secret.');
    expect(markdown).not.toContain('So is this.');
    expect(dropped.map((drops) => drops.kind)).toContain('comment');
  });

  it("keeps a footnote of a shown block from taking over one of the note's own", async () => {
    const note = 'Our claim.[^1]\n\n![[Sources#Cited]]\n\n[^1]: Our source.\n';

    const { markdown } = await exported(note).result;

    const labels = [...markdown.matchAll(/^\[\^([^\]]+)\]:/gm)].map((match) => match[1]);
    expect(markdown).toContain('Our source.');
    expect(markdown).toContain('Their source.');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('names a frontmatter that is not a map of properties, rather than losing it unsaid', async () => {
    const note = '---\n- Mara Quill\n- Tobias Fenn\n---\nBody\n';

    const { markdown, dropped } = await exported(note).result;

    expect(markdown).toBe('Body\n');
    expect(dropped.map((drops) => drops.kind)).toContain('property');
  });

  it("keeps a link's words as words in a block it cannot model: no list opens", async () => {
    const note = '[[1. Kickoff]] covers it.[^1]\n\n[^1]: Agreed.\n';

    const { markdown } = await exported(note).result;

    expect(markdown).toContain('Kickoff covers it.');
    expect(blocksOf(markdown)[0]?.type).toBe('paragraph');
  });

  it("keeps a link's words as words in a block it cannot model: no heading opens", async () => {
    const note = 'Summary[^1]\n[[Plans|===]]\n\n[^1]: Agreed.\n';

    const { markdown } = await exported(note).result;

    expect(blocksOf(markdown)[0]?.type).toBe('paragraph');
  });

  it("keeps a link's words from becoming a link to somewhere else", async () => {
    const { markdown } = await exported('Read [[Plans|www.example.com]] first.\n').result;

    const [first] = blocksOf(markdown);
    expect(first?.type).toBe('paragraph');
    expect(first?.type === 'paragraph' && first.children.map((child) => child.type)).toEqual([
      'text',
    ]);
  });

  it('leaves code as it is, an id-like ending inside a code span included', async () => {
    const note = 'Start `span\nend ^c1\n` done[^1]\n\n[^1]: Agreed.\n';

    const { markdown, dropped } = await exported(note).result;

    expect(markdown).toContain('end ^c1\n`');
    expect(dropped).not.toContainEqual({ kind: 'block-id', items: ['c1'] });
  });
});

describe('a note exported for Confluence, after review (P32-07)', () => {
  it('writes a reference link or image in place, and names one the page cannot reach', async () => {
    const note = [
      'See [the spec][d] and [the site][s] and ![pic][p] <img src="attachments/p.png" alt="Plan">.',
      '',
      '[d]: Docs/Spec.md',
      '[s]: https://example.com',
      '[p]: https://example.com/p.png',
      '',
    ].join('\n');

    const { markdown, dropped } = await exported(note).result;

    expect(markdown).toBe(
      'See the spec and [the site](https://example.com) and ' +
        '![pic](https://example.com/p.png) \\[Image: Plan\\].\n',
    );
    expect(dropped).toEqual([
      { kind: 'link', items: ['Docs/Spec.md'] },
      { kind: 'image', items: ['attachments/p.png'] },
    ]);
  });

  it('keeps an image on the web, and names the link around it the page cannot follow', async () => {
    const { markdown, dropped } = await exported(
      'Logo: [![map](https://example.com/m.png)](Docs/Map.md)\n',
    ).result;

    expect(markdown).toBe('Logo: ![map](https://example.com/m.png)\n');
    expect(dropped).toEqual([{ kind: 'link', items: ['Docs/Map.md'] }]);
  });

  it('keeps an id-like ending mid-paragraph as text, in a block it models or not', async () => {
    const modelled = await exported('One ^a1\ntwo\n').result;
    const raw = await exported('One ^a1\ntwo <b>x</b>\n').result;

    expect(modelled).toEqual({ title: 'Weekly sync', markdown: 'One ^a1\ntwo\n', dropped: [] });
    expect(raw).toEqual({ title: 'Weekly sync', markdown: 'One ^a1\ntwo <b>x</b>\n', dropped: [] });
  });

  it('converts a callout inside one it cannot model, and lists each fold by its marker', async () => {
    const note = '> [!warning]- Outer\n> Body.[^1]\n> > [!tip]+ Inner\n> > body\n\n[^1]: Why.\n';

    const { markdown, dropped } = await exported(note).result;

    expect(markdown).toBe(
      '> **Warning:** Outer\n> Body.[^1]\n> > **Tip:** Inner\n> > body\n\n[^1]: Why.\n',
    );
    expect(dropped).toEqual([{ kind: 'callout-fold', items: ['[!warning]-', '[!tip]+'] }]);
  });

  it('names nothing for a frontmatter block with nothing in it', async () => {
    expect(await exported('---\n---\nBody\n').result).toEqual({
      title: 'Weekly sync',
      markdown: 'Body\n',
      dropped: [],
    });
  });

  it('names frontmatter of comments alone, or of a single value, as not properties', async () => {
    for (const frontmatter of ['# just a comment', 'hello']) {
      const { markdown, dropped } = await exported(`---\n${frontmatter}\n---\nBody\n`).result;
      expect(markdown).toBe('Body\n');
      expect(dropped).toEqual([
        { kind: 'property', items: ['(frontmatter that is not properties)'] },
      ]);
    }
  });

  it("keeps a link's words from becoming a link, in a block it cannot model too", async () => {
    const { markdown } = await exported('Ask [[Plans|www.example.com]] <b>x</b>\n').result;

    expect(markdown).toBe('Ask www\u2060.example.com <b>x</b>\n');
    const [first] = blocksOf(markdown);
    expect(first?.type === 'paragraph' && first.children.map((child) => child.type)).toEqual([
      'text',
      'html',
      'text',
      'html',
    ]);
  });
});

describe('a note exported for Confluence, attacked again (P32-07)', () => {
  /** Every link, image and definition on the page that goes somewhere the page cannot follow. */
  const unreachableOn = (markdown: string): string[] => {
    const found: string[] = [];
    const visit = (node: Nodes) => {
      const goes = node.type === 'link' || node.type === 'image' || node.type === 'definition';
      if (goes && !/^(?:https?:|mailto:)/i.test(node.url)) found.push(node.url);
      if ('children' in node) for (const child of node.children) visit(child as Nodes);
    };
    visit(unified().use(remarkParse).use(remarkGfm).parse(markdown));
    return found;
  };

  it('puts no vault link or image on the page when an HTML block opens with a vault image', async () => {
    const note =
      '<img src="attachments/diagram.png" width="400">\n' +
      'See [the spec](Docs/Spec.md) and ![map](attachments/map.png).\n';

    const { markdown, dropped } = await exported(note).result;

    expect(dropped).toContainEqual({ kind: 'image', items: ['attachments/diagram.png'] });
    expect(unreachableOn(markdown)).toEqual([]);
  });

  it('puts no vault link on the page when an HTML block opens with a comment', async () => {
    const { markdown, dropped } = await exported('<!-- todo --> See [the spec](Docs/Spec.md).\n')
      .result;

    expect(dropped).toContainEqual({ kind: 'comment', items: ['<!-- todo -->'] });
    expect(unreachableOn(markdown)).toEqual([]);
  });

  it("keeps a dropped link's words from opening a code fence that takes the rest of the page", async () => {
    const note = 'Intro <b>x</b>\n[```](Docs/Spec.md)\n\nNext paragraph.\n\n# Heading\n';

    const { markdown } = await exported(note).result;

    expect(blocksOf(markdown).map((block) => block.type)).toEqual([
      'paragraph',
      'paragraph',
      'heading',
    ]);
  });

  it("keeps a dropped link's words from opening a list, a heading or a quote, or underlining a line", async () => {
    for (const words of ['1. Plan', '- Plan', '# Plan', '> Plan', '---']) {
      const { markdown } = await exported(`Intro <b>x</b>\n[${words}](Docs/Spec.md) more\n`).result;

      expect(blocksOf(markdown).map((block) => block.type)).toEqual(['paragraph']);
    }
  });

  it("keeps a shown block's footnote apart from the note's own label that differs only in case", async () => {
    const note = 'Ours.[^sources-1]\n\n![[Sources#Cited]]\n\n[^sources-1]: Our own.\n';

    const { markdown } = await exported(note).result;

    const identifiers = blocksOf(markdown).flatMap((block) =>
      block.type === 'footnoteDefinition' ? [block.identifier] : [],
    );
    expect(identifiers).toHaveLength(2);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('keeps a table cell whole when a reference link in it is written in place', async () => {
    const note = '| Query |\n| - |\n| [logs][q] <b>x</b> |\n\n[q]: https://example.com/q?a|b\n';

    const { markdown } = await exported(note).result;

    const [table] = blocksOf(markdown);
    const row = table?.type === 'table' ? table.children[1] : undefined;
    expect(row?.children).toHaveLength(1);
    const [link] = row?.children[0]?.children.filter((node) => node.type === 'link') ?? [];
    expect(link?.type === 'link' && decodeURIComponent(link.url)).toBe('https://example.com/q?a|b');
  });

  it('exports a callout whose marker a definition also names, rather than failing', async () => {
    const note = '> [!note] Title[^1]\n\n[^1]: Why.\n\n[!note]: https://example.com\n';

    const { markdown } = await exported(note).result;

    expect(markdown).toContain('**Note:** Title');
  });

  it('writes a reference in place with the definition the note reads, the first of two', async () => {
    const note =
      '[dup]: https://example.com/1\n\n> See [c][dup].[^1]\n>\n> [dup]: https://example.com/2\n\n[^1]: n.\n';

    const { markdown } = await exported(note).result;

    expect(markdown).toContain('[c](https://example.com/1)');
  });

  it("keeps a dropped link's words from becoming an email link", async () => {
    for (const note of [
      'Ask [mara@example.com](People/Mara%20Quill.md) now.\n',
      'Ask [mara@example.com](People/Mara%20Quill.md) now <b>x</b>\n',
    ]) {
      const { markdown } = await exported(note).result;
      const [first] = blocksOf(markdown);

      expect(
        first?.type === 'paragraph' && first.children.map((child) => child.type),
      ).not.toContain('link');
    }
  });
});
