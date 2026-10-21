/**
 * Attack on PR #502 (#501): saving exports through the real markdown reader
 * and writer, with notes shaped the way a real vault holds them.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import {
  fakeIndexPort,
  fakePdfRenderer,
  readOnlyVault,
  recordingExportFiles,
  saveExport,
  type FileFormat,
} from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const picture = (marker: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, marker]);

function setUp(
  vault: Record<string, string | Uint8Array>,
  picked: { path: string; companion?: string | null },
) {
  const notePaths = Object.keys(vault)
    .filter((path) => path.endsWith('.md'))
    .map(createVaultPath);
  const files = recordingExportFiles(picked);
  const ports = {
    fs: readOnlyVault(vault),
    markdown: remarkMarkdown,
    index: fakeIndexPort(),
    files: files.port,
    pdf: fakePdfRenderer(),
    renderer: { bodyHtml: (doc: unknown) => `<pre>${JSON.stringify(doc)}</pre>`, styles: '' },
    clock: { today: () => '2026-10-21', now: () => 0, localNow: () => '2026-10-21T09:00:00' },
  };
  const run = (format: FileFormat, paths: string[]) =>
    saveExport(ports, { format, paths: paths as VaultPath[], notePaths, keepFrontmatter: false });
  return { run, files: files.state };
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

/** The bytes a Markdown file's picture link leads to, among what was written. */
function linkedPicture(written: Map<string, Uint8Array>, markdownFile: string) {
  const href = /!\[[^\]]*\]\(([^)]+)\)/.exec(text(written.get(markdownFile)))?.[1];
  return href === undefined ? undefined : written.get(decodeURIComponent(href));
}

describe('exporting notes as they sit in a real vault (attack on #502)', () => {
  it('links each of two notes to its own picture when both name a "diagram.png" of their folder', async () => {
    const { run, files } = setUp(
      {
        'Larkspur/Alpha.md': 'Alpha ![](diagram.png)\n',
        'Northwind/Beta.md': 'Beta ![](diagram.png)\n',
        'Larkspur/diagram.png': picture(1),
        'Northwind/diagram.png': picture(2),
      },
      { path: '/Exports/Exported notes 2026-10-21' },
    );
    await run('standalone', ['Larkspur/Alpha.md', 'Northwind/Beta.md']);
    expect(linkedPicture(files.written, 'Alpha.md')).toEqual(picture(1));
    expect(linkedPicture(files.written, 'Beta.md')).toEqual(picture(2));
  });

  it('copies the picture an embedded note names beside itself, in its own folder', async () => {
    const { run, files } = setUp(
      {
        'Home.md': 'Top\n\n![[Projects/Budget]]\n',
        'Projects/Budget.md': 'Budget ![Chart](chart.png)\n',
        'Projects/chart.png': picture(3),
      },
      { path: '/Exports/Home.md', companion: '/Exports/Home attachments' },
    );
    const outcome = await run('standalone', ['Home.md']);
    expect(outcome).toMatchObject({ attachments: 1, picturesLeftOut: 0 });
    expect(linkedPicture(files.written, '')).toEqual(picture(3));
  });

  it('quotes a block an embedded note shows, rather than calling it not found', async () => {
    const { run, files } = setUp(
      {
        'Home.md': 'Top\n\n![[Budget]]\n',
        'Budget.md': 'Budget\n\n![[Plan#^b1]]\n',
        'Plan.md': 'Line one ^b1\n',
      },
      { path: '/Exports/Home.md' },
    );
    await run('standalone', ['Home.md']);
    const written = text(files.written.get(''));
    expect(written).not.toContain('Not found');
    expect(written).toContain('Line one');
  });

  it('gives two titles a Mac disk takes for one name (NFC and NFD "Café") different files', async () => {
    const { run, files } = setUp(
      { 'Larkspur/Café.md': 'composed\n', 'Northwind/Café.md': 'decomposed\n' },
      { path: '/Exports/Exported notes 2026-10-21' },
    );
    await run('standalone', ['Larkspur/Café.md', 'Northwind/Café.md']);
    const onDisk = new Set([...files.written.keys()].map((name) => name.normalize('NFC')));
    expect(onDisk.size).toBe(2);
  });

  it('suggests a file name, and an attachments folder, a Mac disk can hold (255 bytes) for a long CJK title', async () => {
    const title = '議事録'.repeat(50);
    const { run, files } = setUp(
      { [`Meetings/${title}.md`]: 'x ![](p.png)\n', 'Meetings/p.png': picture(4) },
      { path: '/Exports/a.md', companion: '/Exports/a attachments' },
    );
    await run('standalone', [`Meetings/${title}.md`]);
    const asked = files.asked[0];
    if (asked?.kind !== 'file') throw new Error('a single note asks for a file');
    const bytes = (name: string) => new TextEncoder().encode(name).byteLength;
    expect(bytes(asked.suggestedName)).toBeLessThanOrEqual(255);
    const companion = `${asked.suggestedName.replace(/\.md$/, '')}${asked.companionSuffix ?? ''}`;
    expect(bytes(companion)).toBeLessThanOrEqual(255);
  });

  it('counts a PDF’s pictures that are not in the vault as left out, as standalone does', async () => {
    const { run } = setUp(
      { 'Notes.md': 'x ![](gone.png) ![[gone too.png]]\n' },
      {
        path: '/Exports/Notes.pdf',
      },
    );
    expect(await run('pdf', ['Notes.md'])).toMatchObject({ picturesLeftOut: 2 });
  });
});
