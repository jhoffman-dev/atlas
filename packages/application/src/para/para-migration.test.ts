/**
 * #213: moving Area and Resource notes onto the one Project type — offered,
 * previewed, then run — over a vault in memory whose frontmatter is JSON, so
 * what each file says can be read back whole. How the real writer keeps
 * every byte of YAML is the adapters' integration test.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, PARA_CANDIDATES_QUERY_MARK, splitFrontmatter } from '@atlas/domain';
import type { MigrationPanes } from '../gtd/run-task-migration.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import {
  hasParaMigrationWork,
  previewParaMigration,
  runParaMigration,
  type ParaMigrationPorts,
} from './para-migration.ts';

function jsonFrontmatter(): MarkdownPort {
  const read = (frontmatter: string | null): Record<string, unknown> => {
    const inner = (frontmatter ?? '')
      .replace(/^---\n/, '')
      .replace(/---\n?$/, '')
      .trim();
    return inner === '' ? {} : (JSON.parse(inner) as Record<string, unknown>);
  };
  return {
    ...fakeMarkdown(),
    frontmatterProperties: read,
    updateFrontmatter: (frontmatter, changes) => {
      const next = read(frontmatter);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined) delete next[key];
        else next[key] = value;
      }
      return `---\n${JSON.stringify(next)}\n---\n`;
    },
  };
}

const note = (frontmatter: unknown, body = '\n# Mine\n\nKept *exactly*.\n') =>
  `---\n${JSON.stringify(frontmatter)}\n---\n${body}`;

const PROJECT_TYPE = note(
  { name: 'project', label: 'Project', properties: { status: 'select', budget: 'number' } },
  '\n# Project\n',
);

const FILES: Record<string, string> = {
  '.atlas/types/project.md': PROJECT_TYPE,
  '.atlas/types/area.md': note({ name: 'area', label: 'Area', properties: {} }),
  '.atlas/types/resource.md': note({ name: 'resource', label: 'Resource', properties: {} }),
  '.atlas/templates/Area.md': note({ type: 'area' }),
  'Areas/Garden.md': note({ type: 'area', owner: '[[Mara Quill]]', description: 'Beds' }),
  'Resources/Manual.md': note({
    type: 'Resource',
    url: 'https://example.com/manual',
    project: '[[Garden]]',
  }),
  'Archive/Areas/Old Club.md': note({ type: 'area', archived: '2026-01-02' }),
  'Archive/Projects/Launch.md': note({ type: 'project', status: 'done' }),
  'Archive/Projects/Done.md': note({ type: 'project', para: 'archive' }),
  'Projects/Atlas.md': note({ type: 'project', status: 'active' }),
  'Tasks/Call the bank.md': note({ type: 'task', project: '[[Garden]]' }),
};

function vault(files: Record<string, string> = FILES, overrides: Partial<VaultFsPort> = {}) {
  const memory = memoryVault(files);
  const fs = fakeVaultFs({
    ...memory.fs,
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 7, size: text.length }];
      }),
    ...overrides,
  });
  const markdown = jsonFrontmatter();
  const typeOf = (text: string) =>
    markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['type'];
  const asked: string[] = [];
  // A stand-in for the index's `props`: the notes whose type is one the statement names, in any case.
  const index = fakeIndexPort({
    query: async (sql, parameters) => {
      asked.push(sql);
      const named = new Set(parameters.map(String));
      const paths = [...memory.files]
        .filter(([, text]) =>
          named.has(
            String(typeOf(text) ?? '')
              .trim()
              .toLowerCase(),
          ),
        )
        .map(([path]) => [path]);
      return { columns: ['path'], rows: paths, truncated: false };
    },
  });
  const ports: ParaMigrationPorts = { fs, markdown, index };
  return { ports, files: memory.files, asked };
}

const closedPanes: MigrationPanes = { state: () => 'closed', reload: () => {} };

const frontmatterOf = (text: string | undefined) =>
  JSON.parse((text ?? '').split('\n')[1] ?? '{}') as Record<string, unknown>;

describe('previewParaMigration', () => {
  it('lists every Area and Resource note, and every PARA note in the Archive folder', async () => {
    const { ports } = vault();
    const preview = await previewParaMigration(ports);
    expect(preview.notes.map((line) => line.line).sort()).toEqual([
      'Garden: Area → Project, PARA Area',
      'Launch: PARA (none) → PARA Archive',
      'Manual: Resource → Project, PARA Resource',
      'Old Club: Area → Project, PARA Archive',
    ]);
    expect(hasParaMigrationWork(preview)).toBe(true);
  });

  it('says what the Project type gains for them', async () => {
    const { ports } = vault();
    expect((await previewParaMigration(ports)).typeLines).toEqual(['Project gains PARA.']);
  });

  it('asks the index once for every PARA note, in any spelling, and writes nothing', async () => {
    const { ports, asked, files } = vault();
    const before = new Map(files);
    await previewParaMigration(ports);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.startsWith(PARA_CANDIDATES_QUERY_MARK)).toBe(true);
    expect(files).toEqual(before);
  });

  it('has nothing to do in a vault whose PARA is already one type', async () => {
    const { ports } = vault({
      '.atlas/types/project.md': PROJECT_TYPE,
      'Projects/Atlas.md': note({ type: 'project' }),
      'Garden.md': note({ type: 'project', para: 'area' }),
    });
    expect(hasParaMigrationWork(await previewParaMigration(ports))).toBe(false);
  });
});

describe('runParaMigration', () => {
  async function run(v = vault(), panes = closedPanes) {
    const preview = await previewParaMigration(v.ports);
    return { report: await runParaMigration({ ports: v.ports, panes, preview }), ...v };
  }

  it('rewrites only type and para, keeping every property the person added and every byte of the body', async () => {
    const { files, report } = await run();
    expect(report.left).toEqual([]);
    expect(report.written.length).toBe(4);
    expect(files.get('Areas/Garden.md')).toBe(
      note({
        type: 'project',
        owner: '[[Mara Quill]]',
        description: 'Beds',
        para: 'area',
      }),
    );
    expect(frontmatterOf(files.get('Resources/Manual.md'))).toEqual({
      type: 'project',
      url: 'https://example.com/manual',
      project: '[[Garden]]',
      para: 'resource',
    });
    expect(frontmatterOf(files.get('Archive/Projects/Launch.md'))).toEqual({
      type: 'project',
      status: 'done',
      para: 'archive',
    });
  });

  it('moves no file: an archived one keeps its path, its stamp and all', async () => {
    const { files } = await run();
    expect(frontmatterOf(files.get('Archive/Areas/Old Club.md'))).toEqual({
      type: 'project',
      archived: '2026-01-02',
      para: 'archive',
    });
    expect([...files.keys()].sort()).toEqual(Object.keys(FILES).sort());
  });

  it('leaves alone every note it did not list: a project in use, a task, a template', async () => {
    const { files } = await run();
    for (const path of [
      'Projects/Atlas.md',
      'Tasks/Call the bank.md',
      '.atlas/templates/Area.md',
      'Archive/Projects/Done.md',
      '.atlas/types/area.md',
      '.atlas/types/resource.md',
    ]) {
      expect(files.get(path)).toBe(FILES[path]);
    }
  });

  it('gives the Project type PARA, after what it had', async () => {
    const v = vault();
    await run(v);
    const project = (await loadObjectTypes(v.ports)).find((type) => type.name === 'project');
    expect(project?.properties.map((property) => property.key)).toEqual([
      'status',
      'budget',
      'para',
    ]);
  });

  it('writes the Project type into a vault that has none', async () => {
    const v = vault({ 'Areas/Garden.md': note({ type: 'area' }) });
    const preview = await previewParaMigration(v.ports);
    expect(preview.typeLines).toEqual(['Adds the Project type.']);
    await runParaMigration({ ports: v.ports, panes: closedPanes, preview });
    expect(v.files.has('.atlas/types/project.md')).toBe(true);
    expect(frontmatterOf(v.files.get('Areas/Garden.md'))).toEqual({
      type: 'project',
      para: 'area',
    });
  });

  it('is a no-op when run again', async () => {
    const v = vault();
    await run(v);
    const after = new Map(v.files);
    const preview = await previewParaMigration(v.ports);
    expect(hasParaMigrationWork(preview)).toBe(false);
    expect(preview.typeLines).toEqual([]);
    const again = await runParaMigration({ ports: v.ports, panes: closedPanes, preview });
    expect(again).toEqual({ written: [], left: [] });
    expect(v.files).toEqual(after);
  });

  it('writes only the notes the preview showed: one arrived since waits for the next', async () => {
    const v = vault();
    const preview = await previewParaMigration(v.ports);
    v.files.set('Areas/Health.md', note({ type: 'area' }));
    const report = await runParaMigration({ ports: v.ports, panes: closedPanes, preview });
    expect(report.written).not.toContain('Areas/Health.md');
    expect(v.files.get('Areas/Health.md')).toBe(note({ type: 'area' }));
  });

  it('leaves a note with unsaved typing as it is, and says so, moving the rest', async () => {
    const dirty: MigrationPanes = {
      state: (path) => (path === 'Areas/Garden.md' ? 'dirty' : 'closed'),
      reload: () => {},
    };
    const { files, report } = await run(vault(), dirty);
    expect(report.left).toEqual([
      {
        path: 'Areas/Garden.md',
        reason: 'It is open in Atlas with unsaved typing, so it was left as it is.',
      },
    ]);
    expect(files.get('Areas/Garden.md')).toBe(FILES['Areas/Garden.md']);
    expect(report.written).toHaveLength(3);
  });

  it('reads a shown note again once written, and refuses to write over one changed since it was read', async () => {
    const reloaded: string[] = [];
    const shown: MigrationPanes = {
      state: (path) => (path === 'Resources/Manual.md' ? 'clean' : 'closed'),
      reload: (path) => reloaded.push(path),
    };
    const memory = vault();
    const refusing = vault(FILES, {
      writeTextFile: async (write) => {
        if (write.path === 'Areas/Garden.md') {
          throw new Error('It changed on disk since it was read.');
        }
        expect(write.expectedModified).toBe(7);
        return memory.ports.fs.writeTextFile(write);
      },
    });
    const preview = await previewParaMigration(refusing.ports);
    const report = await runParaMigration({ ports: refusing.ports, panes: shown, preview });
    expect(report.left).toContainEqual({
      path: createVaultPath('Areas/Garden.md'),
      reason: 'It changed on disk since it was read.',
    });
    expect(reloaded).toEqual(['Resources/Manual.md']);
  });

  it('says a Project type it could not change, and still moves the notes', async () => {
    const v = vault(FILES, {
      writeTextFile: async ({ path }) => {
        if (path === '.atlas/types/project.md') throw new Error('Permission denied');
        return 8;
      },
    });
    const preview = await previewParaMigration(v.ports);
    const report = await runParaMigration({ ports: v.ports, panes: closedPanes, preview });
    expect(report.left).toEqual([{ path: '.atlas/types/project.md', reason: 'Permission denied' }]);
    expect(report.written).toHaveLength(4);
  });
});
