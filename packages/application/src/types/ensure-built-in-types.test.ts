/**
 * Opening a vault writes the PARA types it has no file for, and offers —
 * never makes — the change PARA would like in its own types. Over a vault in
 * memory whose frontmatter is JSON, so what each file ends up saying can be
 * read back whole; how the real writer keeps every byte is the adapters'.
 */
import { describe, expect, it } from 'vitest';
import { relationTypes, splitFrontmatter, type VaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { ensureBuiltInTypes, extendBuiltInTypes } from './ensure-built-in-types.ts';
import { loadObjectTypes } from './load-types.ts';

/** Frontmatter as one JSON object, changed key by key as the port promises. */
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

const note = (frontmatter: unknown, body = '\n# Mine\n') =>
  `---\n${JSON.stringify(frontmatter)}\n---\n${body}`;

function vault(files: Record<string, string>) {
  const memory = memoryVault(files);
  const fs = fakeVaultFs({
    ...memory.fs,
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
  return { fs, files: memory.files, markdown: jsonFrontmatter() };
}

const JAMES_PROJECT = note({
  name: 'project',
  label: 'Project',
  properties: { status: 'select', budget: { kind: 'number', label: 'Budget' } },
});

const JAMES_TASK = note(
  {
    name: 'task',
    label: 'Task',
    properties: { status: 'select', estimate: { kind: 'text', label: 'Size' } },
  },
  '\n# Task\n\nJames’s own words about tasks.\n',
);

describe('ensureBuiltInTypes', () => {
  it('adds the area type to a vault missing it, and leaves the project James wrote alone', async () => {
    const v = vault({ '.atlas/types/project.md': JAMES_PROJECT });

    const ensured = await ensureBuiltInTypes(v);

    expect(ensured.created).toEqual(['.atlas/types/area.md', '.atlas/types/resource.md']);
    expect(v.files.get('.atlas/types/project.md')).toBe(JAMES_PROJECT);
    const types = await loadObjectTypes(v);
    expect(types.map((type) => type.name)).toEqual(['area', 'project', 'resource']);
    const area = v.files.get('.atlas/types/area.md') ?? '';
    expect(splitFrontmatter(area).body).toContain('# Area');
  });

  it('writes every PARA type into a vault that has no types folder yet', async () => {
    const v = vault({ 'Notes/Hello.md': 'hello\n' });
    const ensured = await ensureBuiltInTypes(v);
    expect(ensured.created).toHaveLength(3);
    const resource = (await loadObjectTypes(v)).find((type) => type.name === 'resource');
    const filedUnder = resource?.properties.find((property) => property.key === 'project');
    expect(filedUnder === undefined ? [] : relationTypes(filedUnder)).toEqual(['project', 'area']);
  });

  it('writes nothing to a vault that has every PARA type', async () => {
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/area.md': note({ name: 'area' }),
      '.atlas/types/resource.md': note({
        name: 'resource',
        properties: { project: { kind: 'relation', target: ['project', 'area'] } },
      }),
    });
    const before = new Map(v.files);
    const ensured = await ensureBuiltInTypes(v);
    expect(ensured).toEqual({ created: [], pending: [], failed: [] });
    expect(v.files).toEqual(before);
  });

  it('only offers to change a type the vault has: its task file is not touched on opening', async () => {
    const v = vault({ '.atlas/types/task.md': JAMES_TASK });
    const ensured = await ensureBuiltInTypes(v);
    expect(v.files.get('.atlas/types/task.md')).toBe(JAMES_TASK);
    expect(ensured.pending.map((extension) => extension.before.path)).toEqual([
      '.atlas/types/task.md',
    ]);
  });

  it('never writes over a type file it cannot read, and says so', async () => {
    const broken = '---\nnot json at all\n---\n';
    const v = vault({ '.atlas/types/area.md': broken });
    const ensured = await ensureBuiltInTypes({
      ...v,
      markdown: {
        ...v.markdown,
        frontmatterProperties: (frontmatter) => {
          if (frontmatter?.includes('not json') === true) throw new Error('unreadable');
          return v.markdown.frontmatterProperties(frontmatter);
        },
      },
    });
    expect(v.files.get('.atlas/types/area.md')).toBe(broken);
    expect(ensured.failed).toEqual([{ name: 'Area', reason: 'already there' }]);
    expect(ensured.created).toEqual(['.atlas/types/project.md', '.atlas/types/resource.md']);
  });
});

describe('extendBuiltInTypes', () => {
  it('gives the task a project that links a project or an area, keeping everything James wrote', async () => {
    const v = vault({ '.atlas/types/task.md': JAMES_TASK });
    const { pending } = await ensureBuiltInTypes(v);

    const done = await extendBuiltInTypes({ ...v, extensions: pending });

    expect(done).toEqual({ extended: ['.atlas/types/task.md'], failed: [] });
    const text = v.files.get('.atlas/types/task.md') ?? '';
    expect(splitFrontmatter(text).body).toBe('\n# Task\n\nJames’s own words about tasks.\n');
    const properties = v.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)[
      'properties'
    ];
    expect(properties).toEqual({
      status: 'select',
      estimate: { kind: 'text', label: 'Size' },
      project: { kind: 'relation', target: ['project', 'area'] },
    });
  });

  it('reports a type it could not write and carries on with the rest', async () => {
    const meeting = note({
      name: 'meeting',
      properties: { project: { kind: 'relation', target: 'project' } },
    });
    const v = vault({ '.atlas/types/task.md': JAMES_TASK, '.atlas/types/meeting.md': meeting });
    const { pending } = await ensureBuiltInTypes(v);
    const refusing = {
      ...v.fs,
      writeTextFile: async (args: { path: VaultPath; contents: string }) => {
        if (args.path.endsWith('task.md')) throw new Error('the disk is full');
        return v.fs.writeTextFile({ ...args, expectedModified: null });
      },
    };

    const done = await extendBuiltInTypes({ ...v, fs: refusing, extensions: pending });

    expect(done.failed).toEqual([{ name: 'Task', reason: 'the disk is full' }]);
    expect(done.extended).toEqual(['.atlas/types/meeting.md']);
    const widened = (await loadObjectTypes(v)).find((type) => type.name === 'meeting');
    expect(widened?.properties.map((property) => relationTypes(property))).toEqual([
      ['project', 'area'],
    ]);
  });
});
