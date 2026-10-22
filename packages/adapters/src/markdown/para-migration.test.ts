/**
 * #213: the move onto the Project type through the real YAML reader and
 * writer — every byte of a note but its `type` and `para` lines kept, and a
 * second run changing nothing.
 */
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '@dfai/domain';
import {
  fakeIndexPort,
  fakeVaultFs,
  memoryVault,
  previewParaMigration,
  runParaMigration,
  type MigrationPanes,
  type ParaMigrationPorts,
} from '@dfai/application';
import { remarkMarkdown } from './markdown-port.ts';

const GARDEN = [
  '---',
  '# Mara Quill keeps the garden here.',
  'type: Area',
  'owner: "[[Mara Quill]]"',
  'tags: [home, outdoors]',
  'review:   weekly   # odd spacing, kept',
  '---',
  '',
  '# Garden',
  '',
  'Beds, compost and the *shed*.',
  '',
].join('\n');

const LAUNCH = [
  '---',
  'type: project',
  'status: done',
  'archived: 2026-01-02',
  'archivedFrom: Projects/Launch.md',
  '---',
  'Shipped for Larkspur Payroll.',
  '',
].join('\n');

const PROJECT_TYPE = [
  '---',
  'name: project',
  'label: Project',
  'properties:',
  '  # Tobias Fenn added the budget.',
  '  budget: number',
  '  status: select',
  '---',
  '',
  '# Project',
  '',
].join('\n');

function vault() {
  const memory = memoryVault({
    '.atlas/types/project.md': PROJECT_TYPE,
    'Areas/Garden.md': GARDEN,
    'Archive/Projects/Launch.md': LAUNCH,
  });
  const fs = fakeVaultFs({
    ...memory.fs,
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
  const typeOf = (text: string) =>
    remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['type'];
  const index = fakeIndexPort({
    query: async (_sql, parameters) => ({
      columns: ['path'],
      rows: [...memory.files]
        .filter(([, text]) =>
          parameters.includes(
            String(typeOf(text) ?? '')
              .trim()
              .toLowerCase(),
          ),
        )
        .map(([path]) => [path]),
      truncated: false,
    }),
  });
  const ports: ParaMigrationPorts = { fs, markdown: remarkMarkdown, index };
  return { ports, files: memory.files };
}

const closed: MigrationPanes = { state: () => 'closed', reload: () => {} };

async function run(ports: ParaMigrationPorts) {
  const preview = await previewParaMigration(ports);
  return runParaMigration({ ports, panes: closed, preview });
}

describe('the move onto the Project type, through the real YAML writer', () => {
  it('changes only the type line and adds the PARA one, keeping every other byte', async () => {
    const { ports, files } = vault();
    await run(ports);
    expect(files.get('Areas/Garden.md')).toBe(
      GARDEN.replace('type: Area\n', 'type: project\n').replace(
        'review:   weekly   # odd spacing, kept\n',
        'review:   weekly   # odd spacing, kept\npara: area\n',
      ),
    );
  });

  it('archives a Project in the Archive folder by its value, its stamp and text untouched', async () => {
    const { ports, files } = vault();
    await run(ports);
    expect(files.get('Archive/Projects/Launch.md')).toBe(
      LAUNCH.replace(
        'archivedFrom: Projects/Launch.md\n',
        'archivedFrom: Projects/Launch.md\npara: archive\npara_before_archive: project\n',
      ),
    );
  });

  it('gives the Project type PARA after the lines James wrote, comment and all', async () => {
    const { ports, files } = vault();
    await run(ports);
    const written = files.get('.atlas/types/project.md') ?? '';
    expect(written).toContain(
      '  # Tobias Fenn added the budget.\n  budget: number\n  status: select\n  para:\n',
    );
    expect(splitFrontmatter(written).body).toBe(splitFrontmatter(PROJECT_TYPE).body);
  });

  it('changes nothing when run again', async () => {
    const { ports, files } = vault();
    await run(ports);
    const after = new Map(files);
    expect(await run(ports)).toEqual({ written: [], left: [] });
    expect(files).toEqual(after);
  });
});
