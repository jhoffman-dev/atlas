/**
 * Exporting a note for Confluence (P32-07) through the real markdown reader
 * and writer: what the page's markdown says, byte for byte, and what the
 * export says it left out.
 */
import { describe, expect, it } from 'vitest';
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
