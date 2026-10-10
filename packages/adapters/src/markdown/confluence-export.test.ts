/**
 * Exporting a note for Confluence (P32-07) through the real markdown reader
 * and writer: what the page's markdown says, byte for byte, and what the
 * export says it left out.
 */
import { describe, expect, it } from 'vitest';
import type { RootContent } from 'mdast';
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
        'Text with <kbd>x</kbd>',
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
      { kind: 'block-id', items: ['h1', 'r1'] },
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
