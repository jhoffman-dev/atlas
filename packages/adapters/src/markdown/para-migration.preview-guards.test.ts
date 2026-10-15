/**
 * The move onto the Project type (#213), through the real YAML reader and
 * writer: what the preview shows is what is written. A note that already
 * holds a `para` of its own is left as it is and shown as left, with why —
 * no property the person added is ever written over (ADR-0037) — and a note
 * changed after the preview read it is left as it was and reported.
 */
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '@atlas/domain';
import {
  fakeIndexPort,
  fakeVaultFs,
  memoryVault,
  previewParaMigration,
  runParaMigration,
  type MigrationPanes,
  type ParaMigrationPorts,
} from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const PROJECT_TYPE = [
  '---',
  'name: project',
  'label: Project',
  'properties:',
  '  status: select',
  '---',
  '',
].join('\n');

function vault(notes: Record<string, string>) {
  const memory = memoryVault({ '.atlas/types/project.md': PROJECT_TYPE, ...notes });
  const fs = fakeVaultFs({
    ...memory.fs,
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
  const typeOf = (text: string) =>
    String(remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['type'] ?? '')
      .trim()
      .toLowerCase();
  const index = fakeIndexPort({
    query: async (_sql, parameters) => ({
      columns: ['path'],
      rows: [...memory.files]
        .filter(([path, text]) => !path.startsWith('.atlas/') && parameters.includes(typeOf(text)))
        .map(([path]) => [path]),
      truncated: false,
    }),
  });
  const ports: ParaMigrationPorts = { fs, markdown: remarkMarkdown, index };
  return { ports, files: memory.files };
}

const closed: MigrationPanes = { state: () => 'closed', reload: () => {} };

const GARDEN = '---\ntype: area\npara: Life admin\nowner: Mara Quill\n---\n\n# Garden\n';

describe('an Area note that already holds its own `para`', () => {
  it('is shown in the preview as left as it is, with its value and why', async () => {
    const { ports } = vault({ 'Areas/Garden.md': GARDEN });
    const preview = await previewParaMigration(ports);
    expect(preview.notes).toEqual([]);
    expect(preview.skipped.map((note) => note.line)).toEqual([
      'Garden: its PARA “Life admin” is not Project, Area, Resource or Archive, so it is left as it is',
    ]);
  });

  it('is never written over, while the rest move', async () => {
    const { ports, files } = vault({
      'Areas/Garden.md': GARDEN,
      'Areas/Health.md': '---\ntype: area\n---\n\n# Health\n',
    });
    const preview = await previewParaMigration(ports);
    const report = await runParaMigration({ ports, panes: closed, preview });
    expect(report.written).toEqual(['Areas/Health.md']);
    expect(files.get('Areas/Garden.md')).toBe(GARDEN);
    expect(files.get('Areas/Health.md')).toBe('---\ntype: project\npara: area\n---\n\n# Health\n');
  });

  it('is left as it is when its `para` is a map of its own', async () => {
    const text = '---\ntype: resource\npara:\n  shelf: kitchen\n---\n';
    const { ports, files } = vault({ 'Resources/Recipes.md': text });
    const preview = await previewParaMigration(ports);
    expect(preview.skipped.map((note) => note.path)).toEqual(['Resources/Recipes.md']);
    await runParaMigration({ ports, panes: closed, preview });
    expect(files.get('Resources/Recipes.md')).toBe(text);
  });
});

describe('a note changed between the preview and Move N notes', () => {
  it('is left as it was and reported, as the guide says', async () => {
    const { ports, files } = vault({ 'Areas/Garden.md': '---\ntype: area\n---\n\n# Garden\n' });
    const preview = await previewParaMigration(ports);
    // Tobias Fenn edits the note after the preview was read: it is now a resource.
    files.set('Areas/Garden.md', '---\ntype: resource\n---\n\n# Garden\n');
    const report = await runParaMigration({ ports, panes: closed, preview });
    expect(report.left).toEqual([
      { path: 'Areas/Garden.md', reason: 'It changed since the preview read it.' },
    ]);
    expect(report.written).toEqual([]);
    expect(files.get('Areas/Garden.md')).toBe('---\ntype: resource\n---\n\n# Garden\n');
  });
});

describe('notes already in the Archive folder', () => {
  it('become PARA archive, keeping what they were for Unarchive to give back', async () => {
    const { ports, files } = vault({
      'Archive/Areas/Garden.md': '---\ntype: area\n---\n',
      'Archive/Resources/Manual.md': '---\ntype: Resource\n---\n',
      'Archive/Projects/Ledger.md': '---\ntype: project\n---\n',
    });
    const preview = await previewParaMigration(ports);
    await runParaMigration({ ports, panes: closed, preview });
    expect(files.get('Archive/Areas/Garden.md')).toBe(
      '---\ntype: project\npara: archive\npara_before_archive: area\n---\n',
    );
    expect(files.get('Archive/Resources/Manual.md')).toBe(
      '---\ntype: project\npara: archive\npara_before_archive: resource\n---\n',
    );
    expect(files.get('Archive/Projects/Ledger.md')).toBe(
      '---\ntype: project\npara: archive\npara_before_archive: project\n---\n',
    );
    expect((await previewParaMigration(ports)).notes).toEqual([]);
  });
});
