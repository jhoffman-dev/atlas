/**
 * Opening a vault that files by project writes the PARA types it has no file
 * for; anything else — PARA for a vault that has not taken it up, a change to
 * the vault's own types, the Inbox's Proposal and Decision types, the Daily
 * type and the meeting import's keys — is offered, and made only when accepted. Over a vault in
 * memory whose frontmatter is JSON, so what each file ends up saying can be
 * read back whole; how the real writer keeps every byte is the adapters'.
 */
import { describe, expect, it } from 'vitest';
import { relationTypes, splitFrontmatter, type VaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { acceptTypeSetup, ensureBuiltInTypes } from './ensure-built-in-types.ts';
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

/** The types always asked about in a vault that lacks them: the Inbox's, and today's note's. */
const INBOX_TYPES = ['proposal', 'decision', 'daily'];
const offeredNames = (offer: { types: readonly { type: { name: string } }[] }) =>
  offer.types.map((file) => file.type.name);

const JAMES_TASK = note(
  {
    name: 'task',
    label: 'Task',
    properties: { status: 'select', estimate: { kind: 'text', label: 'Size' } },
  },
  '\n# Task\n\nJames’s own words about tasks.\n',
);

describe('ensureBuiltInTypes', () => {
  it('adds the area type to a vault that files by project, and leaves the project James wrote alone', async () => {
    const v = vault({ '.atlas/types/project.md': JAMES_PROJECT });

    const ensured = await ensureBuiltInTypes(v);

    expect(ensured.created).toEqual(['.atlas/types/area.md', '.atlas/types/resource.md']);
    expect(offeredNames(ensured.offer)).toEqual(INBOX_TYPES);
    expect(ensured.offer.extensions).toEqual([]);
    expect(v.files.get('.atlas/types/project.md')).toBe(JAMES_PROJECT);
    const types = await loadObjectTypes(v);
    expect(types.map((type) => type.name)).toEqual(['area', 'project', 'resource']);
    const area = v.files.get('.atlas/types/area.md') ?? '';
    expect(splitFrontmatter(area).body).toContain('# Area');
  });

  it('only offers PARA to a vault that has not taken it up, writing nothing', async () => {
    const v = vault({ 'Notes/Hello.md': 'hello\n' });
    const before = new Map(v.files);
    const ensured = await ensureBuiltInTypes(v);
    expect(ensured.created).toEqual([]);
    expect(offeredNames(ensured.offer)).toEqual(['project', 'area', 'resource', ...INBOX_TYPES]);
    expect(v.files).toEqual(before);
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
    expect(ensured.created).toEqual([]);
    expect(ensured.failed).toEqual([]);
    expect(offeredNames(ensured.offer)).toEqual(INBOX_TYPES);
    expect(v.files).toEqual(before);
  });

  it('offers nothing to a vault that has every type the Inbox and PARA use', async () => {
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/area.md': note({ name: 'area' }),
      '.atlas/types/resource.md': note({
        name: 'resource',
        properties: { project: { kind: 'relation', target: ['project', 'area'] } },
      }),
      '.atlas/types/proposal.md': note({ name: 'proposal' }),
      '.atlas/types/decision.md': note({ name: 'Decision' }),
      '.atlas/types/daily.md': note({ name: 'daily' }),
    });
    const ensured = await ensureBuiltInTypes(v);
    expect(ensured).toEqual({ created: [], offer: { types: [], extensions: [] }, failed: [] });
  });

  it('offers the meeting import’s keys to a Meeting type without them, never writing them', async () => {
    const meeting = note({
      name: 'meeting',
      label: 'Meeting',
      properties: { atlas_import_error: { kind: 'text', label: 'Why it failed' } },
    });
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/meeting.md': meeting,
    });
    const ensured = await ensureBuiltInTypes(v);
    expect(v.files.get('.atlas/types/meeting.md')).toBe(meeting);
    const [extension] = ensured.offer.extensions;
    expect(ensured.offer.extensions).toHaveLength(1);
    expect(extension?.added.map((property) => property.key)).toEqual([
      'project',
      'atlas_import_outcome',
      'atlas_duplicate_of',
    ]);
  });

  it('only offers to change a type the vault has: its task file is not touched on opening', async () => {
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/task.md': JAMES_TASK,
    });
    const ensured = await ensureBuiltInTypes(v);
    expect(v.files.get('.atlas/types/task.md')).toBe(JAMES_TASK);
    expect(ensured.offer.extensions.map((extension) => extension.before.path)).toEqual([
      '.atlas/types/task.md',
    ]);
  });

  it('never writes over a type file it cannot read, and says so', async () => {
    const broken = '---\nnot json at all\n---\n';
    const v = vault({ '.atlas/types/project.md': JAMES_PROJECT, '.atlas/types/area.md': broken });
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
    expect(ensured.created).toEqual(['.atlas/types/resource.md']);
  });
});

describe('acceptTypeSetup', () => {
  it('writes the PARA types offered and gives the task a project, keeping everything James wrote', async () => {
    const v = vault({ '.atlas/types/task.md': JAMES_TASK });
    const { offer } = await ensureBuiltInTypes(v);

    const done = await acceptTypeSetup({ ...v, offer });

    expect(done).toEqual({
      created: [
        '.atlas/types/project.md',
        '.atlas/types/area.md',
        '.atlas/types/resource.md',
        '.atlas/types/proposal.md',
        '.atlas/types/decision.md',
        '.atlas/types/daily.md',
      ],
      extended: ['.atlas/types/task.md'],
      failed: [],
    });
    const proposal = (await loadObjectTypes(v)).find((type) => type.name === 'proposal');
    expect(proposal?.properties.map((property) => property.key)).toEqual([
      'kind',
      'state',
      'confidence',
      'source',
      'made_by',
      'answered_via',
    ]);
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

  it('works the change out from the type files as they are when accepted', async () => {
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/task.md': JAMES_TASK,
    });
    const { offer } = await ensureBuiltInTypes(v);
    // While the offer waits, James removes `estimate` from Task.
    const edited = note({ name: 'task', label: 'Task', properties: { status: 'select' } });
    v.files.set('.atlas/types/task.md', edited);

    await acceptTypeSetup({ ...v, offer });

    const text = v.files.get('.atlas/types/task.md') ?? '';
    expect(
      v.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['properties'],
    ).toEqual({
      status: 'select',
      project: { kind: 'relation', target: ['project', 'area'] },
    });
  });

  it('leaves alone a type that no longer lacks anything by the time it is accepted', async () => {
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/task.md': JAMES_TASK,
    });
    const { offer } = await ensureBuiltInTypes(v);
    const done = note({
      name: 'task',
      properties: { project: { kind: 'relation', target: ['area', 'project'] } },
    });
    v.files.set('.atlas/types/task.md', done);

    const result = await acceptTypeSetup({ ...v, offer });

    expect(result.extended).toEqual([]);
    expect(v.files.get('.atlas/types/task.md')).toBe(done);
  });

  it('changes only the types it offered, not one that came to lack something since', async () => {
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/task.md': JAMES_TASK,
    });
    const { offer } = await ensureBuiltInTypes(v);
    // A Meeting type arrives (a sync, say) while the offer waits; nobody was asked about it.
    const meeting = note({ name: 'meeting', properties: { title: 'text' } });
    v.files.set('.atlas/types/meeting.md', meeting);

    const result = await acceptTypeSetup({ ...v, offer });

    expect(result.extended).toEqual(['.atlas/types/task.md']);
    expect(v.files.get('.atlas/types/meeting.md')).toBe(meeting);
  });

  it('reports a type it could not write and carries on with the rest', async () => {
    const meeting = note({
      name: 'meeting',
      properties: { project: { kind: 'relation', target: 'project' } },
    });
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/task.md': JAMES_TASK,
      '.atlas/types/meeting.md': meeting,
    });
    const { offer } = await ensureBuiltInTypes(v);
    const refusing = {
      ...v.fs,
      writeTextFile: async (args: { path: VaultPath; contents: string }) => {
        if (args.path.endsWith('task.md')) throw new Error('the disk is full');
        return v.fs.writeTextFile({ ...args, expectedModified: null });
      },
    };

    const done = await acceptTypeSetup({ ...v, fs: refusing, offer });

    expect(done.failed).toEqual([{ name: 'Task', reason: 'the disk is full' }]);
    expect(done.extended).toEqual(['.atlas/types/meeting.md']);
    const widened = (await loadObjectTypes(v)).find((type) => type.name === 'meeting');
    expect(widened?.properties.map((property) => property.key)).toEqual([
      'project',
      'atlas_import_outcome',
      'atlas_import_error',
      'atlas_duplicate_of',
    ]);
    expect(relationTypes(widened?.properties[0] ?? { target: null })).toEqual(['project', 'area']);
  });
});
