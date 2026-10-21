/**
 * Exporting notes out of Atlas (#501) through the real markdown reader and
 * writer: "as is" byte for byte, standalone with its links and pictures
 * rewritten, and the page a PDF is made from — never writing to the vault.
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

const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const KICKOFF = [
  '\uFEFF---',
  'title: Kickoff with Larkspur',
  'attendees: ["[[Mara Quill]]"]',
  '---',
  '# Kickoff',
  '',
  'Met with [[Mara Quill]] about [[Retro|the retro]].\r',
  '',
  'Untouched  *line*   kept as   typed.',
  '',
  '![Plan](attachments/plan.png)',
  '',
  '![[Retro]]',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Morning. Shall we start? ^t0001',
  '',
  '**Tobias Fenn** [~00:09:44] Yes, Friday works. ^t0002',
  '',
].join('\n');

const FILES: Record<string, string | Uint8Array> = {
  'Meetings/Kickoff.md': KICKOFF,
  'People/Mara Quill.md': '---\ntitle: Mara Quill\n---\nWorks at Larkspur. See [[Kickoff]].\n',
  'Retro.md': 'Went well.\n',
  'attachments/plan.png': PICTURE,
};

const notePaths = Object.keys(FILES)
  .filter((path) => path.endsWith('.md'))
  .map(createVaultPath);

const KICKOFF_PATH = 'Meetings/Kickoff.md' as VaultPath;
const MARA_PATH = 'People/Mara Quill.md' as VaultPath;

function setUp(picked: { path: string; companion?: string | null } | null) {
  const files = recordingExportFiles(picked);
  const pdf = fakePdfRenderer();
  const ports = {
    fs: readOnlyVault(FILES),
    markdown: remarkMarkdown,
    index: fakeIndexPort(),
    files: files.port,
    pdf,
    renderer: {
      bodyHtml: (doc: unknown) => `<pre>${JSON.stringify(doc)}</pre>`,
      styles: 'body{}',
    },
    clock: { today: () => '2026-10-21', now: () => 0, localNow: () => '2026-10-21T09:00:00' },
  };
  const run = (format: FileFormat, paths: VaultPath[], keepFrontmatter = false) =>
    saveExport(ports, { format, paths, notePaths, keepFrontmatter });
  return { run, files: files.state, pdf };
}

// A byte-order mark is kept, as the file holds it.
const text = (bytes: Uint8Array | undefined) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

describe('saving an export (#501)', () => {
  it('writes "as is" byte for byte, and its pictures in a folder beside it', async () => {
    const { run, files } = setUp({
      path: '/Exports/Kickoff with Larkspur.md',
      companion: '/Exports/Kickoff with Larkspur attachments',
    });
    const outcome = await run('markdown', [KICKOFF_PATH]);

    expect(files.asked).toEqual([
      {
        kind: 'file',
        suggestedName: 'Kickoff with Larkspur.md',
        extension: 'md',
        companionSuffix: ' attachments',
      },
    ]);
    expect(files.written.get('')).toEqual(new TextEncoder().encode(KICKOFF));
    expect(files.written.get('Kickoff with Larkspur attachments/plan.png')).toEqual(PICTURE);
    expect(files.finished).toBe(1);
    expect(outcome).toEqual({
      kind: 'saved',
      format: 'markdown',
      where: '/Exports/Kickoff with Larkspur.md',
      notes: 1,
      attachments: 1,
      picturesLeftOut: 0,
    });
  });

  it('rewrites a standalone export: links as words, embeds quoted, pictures beside it', async () => {
    const { run, files } = setUp({
      path: '/Exports/Kickoff.md',
      companion: '/Exports/Kickoff attachments',
    });
    await run('standalone', [KICKOFF_PATH]);
    const written = text(files.written.get(''));

    expect(written).not.toContain('[[');
    expect(written).not.toContain('title: Kickoff with Larkspur');
    expect(written).toContain('Met with Mara Quill about the retro.');
    expect(written).toContain('![Plan](Kickoff%20attachments/plan.png)');
    expect(written).toContain('> *From Retro*');
    expect(written).toContain('> Went well.');
    // A block the export did not change keeps the bytes it was typed with.
    expect(written).toContain('Untouched  *line*   kept as   typed.');
    // A meeting's turns stay readable: speaker, timestamp and words, without Obsidian's ids.
    expect(written).toMatch(/\*\*Mara Quill\*\* \\?\[~00:00:00\]? Morning\. Shall we start\?\n/);
    expect(written).not.toContain('^t0001');
    expect(files.written.get('Kickoff attachments/plan.png')).toEqual(PICTURE);
  });

  it('keeps the frontmatter, byte for byte, when asked to', async () => {
    const { run, files } = setUp({
      path: '/Exports/Kickoff.md',
      companion: '/Exports/Kickoff attachments',
    });
    await run('standalone', [KICKOFF_PATH], true);
    expect(text(files.written.get(''))).toMatch(
      /^\uFEFF---\ntitle: Kickoff with Larkspur\nattendees: \["\[\[Mara Quill\]\]"\]\n---\n# Kickoff/,
    );
  });

  it('links notes exported together to each other’s files, in a dated folder', async () => {
    const { run, files } = setUp({ path: '/Exports/Exported notes 2026-10-21' });
    const outcome = await run('standalone', [KICKOFF_PATH, MARA_PATH]);

    expect(files.asked).toEqual([{ kind: 'folder', folderName: 'Exported notes 2026-10-21' }]);
    expect([...files.written.keys()].sort()).toEqual([
      'Kickoff with Larkspur.md',
      'Mara Quill.md',
      'attachments/plan.png',
    ]);
    expect(text(files.written.get('Kickoff with Larkspur.md'))).toContain(
      'Met with [Mara Quill](Mara%20Quill.md) about the retro.',
    );
    expect(text(files.written.get('Kickoff with Larkspur.md'))).toContain(
      '![Plan](attachments/plan.png)',
    );
    expect(text(files.written.get('Mara Quill.md'))).toContain(
      '[Kickoff with Larkspur](Kickoff%20with%20Larkspur.md)',
    );
    expect(outcome).toMatchObject({ kind: 'saved', notes: 2, attachments: 1 });
  });

  it('makes a PDF from the note’s page: title, properties, body and the paging script', async () => {
    const { run, files, pdf } = setUp({ path: '/Exports/Kickoff with Larkspur.pdf' });
    await run('pdf', [KICKOFF_PATH]);

    expect(files.asked[0]).toMatchObject({ kind: 'file', extension: 'pdf', companionSuffix: null });
    expect(text(files.written.get('')).startsWith('%PDF')).toBe(true);
    const [page] = pdf.pages;
    expect(page).toContain('<h1 class="export__title">Kickoff with Larkspur</h1>');
    expect(page).toContain('<th scope="row">attendees</th><td>Mara Quill</td>');
    expect(page).toContain('data:image/png;base64,');
    expect(page).toContain(`<script>${pdf.pagingScript}</script>`);
  });

  it('writes nothing when the person cancels the dialog', async () => {
    const { run, files } = setUp(null);
    expect(await run('pdf', [KICKOFF_PATH])).toEqual({ kind: 'cancelled' });
    expect(files.written.size).toBe(0);
    expect(files.finished).toBe(0);
  });

  it('says why a write failed, and still lets the destination go', async () => {
    const { run, files } = setUp({
      path: '/Exports/Kickoff.md',
      companion: '/Exports/Kickoff attachments',
    });
    files.failWrite = new Error('cannot write /Exports/Kickoff.md: Permission denied');
    await expect(run('markdown', [KICKOFF_PATH])).rejects.toThrow('Permission denied');
    expect(files.finished).toBe(1);
  });

  it('says which note could not be read', async () => {
    const { run } = setUp({ path: '/Exports/x.md' });
    await expect(run('markdown', ['Gone.md' as VaultPath])).rejects.toThrow(
      'Gone could not be read: Gone.md is not in the vault',
    );
  });
});
