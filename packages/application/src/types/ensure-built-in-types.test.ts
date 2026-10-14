/**
 * Opening a vault that files by project writes the PARA types it has no file
 * for, and gives each of Atlas's own built-in type files (Meeting, Proposal,
 * Decision, Daily, Block) the properties it ships that the file predates
 * (#162) — once, never changing a key the file has. Anything else — PARA for a
 * vault that has not taken it up, PARA's `project` and PARA's own types' keys,
 * the Task type, the Inbox's types a vault lacks — is offered, and made only
 * when accepted. Over a vault in
 * memory whose frontmatter is JSON, so what each file ends up saying can be
 * read back whole; how the real writer keeps every byte is the adapters'.
 */
import { describe, expect, it } from 'vitest';
import { extensionKeys, relationTypes, splitFrontmatter, type VaultPath } from '@atlas/domain';
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
    // As the port promises: added to a map, or to none yet; never over anything else.
    addToFrontmatterMap: (frontmatter, key, entries) => {
      const next = read(frontmatter);
      const held = next[key];
      if (
        held !== undefined &&
        held !== null &&
        (typeof held !== 'object' || Array.isArray(held))
      ) {
        return null;
      }
      const map = (held ?? {}) as Record<string, unknown>;
      if (Object.keys(entries).some((entry) => Object.hasOwn(map, entry))) return null;
      next[key] = { ...map, ...entries };
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

/** The `properties` a type file declares, keys in the order the file has them. */
function propertiesOf(v: ReturnType<typeof vault>, path: string): Record<string, unknown> {
  const text = v.files.get(path) ?? '';
  const declared = v.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)[
    'properties'
  ];
  return (declared ?? {}) as Record<string, unknown>;
}

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
    const { created, offer, failed } = await ensureBuiltInTypes(v);
    expect({ created, offer, failed }).toEqual({
      created: [],
      offer: { types: [], extensions: [] },
      failed: [],
    });
  });

  it('gives a Meeting type the meeting import’s keys it lacks on opening, and only offers PARA’s project', async () => {
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
    expect(Object.keys(propertiesOf(v, '.atlas/types/meeting.md'))).toEqual([
      'atlas_import_error',
      'atlas_import_outcome',
      'atlas_duplicate_of',
      'tasks',
      'decisions',
    ]);
    const [extension] = ensured.offer.extensions;
    expect(ensured.offer.extensions).toHaveLength(1);
    expect(extension?.added.map((property) => property.key)).toEqual(['project']);
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

describe('ensureBuiltInTypes, on a built-in type file older than what Atlas ships (#162)', () => {
  const RECORD = '.atlas/migrations/type-properties.md';
  /** A Meeting type from before `tasks` and `decisions`, as Mara Quill's vault has it. */
  const OLDER_MEETING = note(
    {
      name: 'meeting',
      label: 'Meeting',
      icon: 'calendar',
      properties: {
        title: 'text',
        atlas_import_outcome: { kind: 'select', label: 'How it came in', options: ['imported'] },
        atlas_import_error: 'text',
        atlas_duplicate_of: { kind: 'relation', target: 'meeting' },
      },
    },
    '\n# Meeting\n\nMara’s own words about meetings.\n',
  );

  it('adds tasks and decisions to a Meeting type that lacks them, keeping its keys, their order and its body', async () => {
    const v = vault({ '.atlas/types/meeting.md': OLDER_MEETING });

    const ensured = await ensureBuiltInTypes(v);

    const properties = propertiesOf(v, '.atlas/types/meeting.md');
    expect(Object.keys(properties)).toEqual([
      'title',
      'atlas_import_outcome',
      'atlas_import_error',
      'atlas_duplicate_of',
      'tasks',
      'decisions',
    ]);
    expect(properties['atlas_import_outcome']).toEqual({
      kind: 'select',
      label: 'How it came in',
      options: ['imported'],
    });
    const text = v.files.get('.atlas/types/meeting.md') ?? '';
    expect(splitFrontmatter(text).body).toBe('\n# Meeting\n\nMara’s own words about meetings.\n');
    const meeting = (await loadObjectTypes(v)).find((type) => type.name === 'meeting');
    const tasks = meeting?.properties.find((property) => property.key === 'tasks');
    expect(tasks).toMatchObject({ kind: 'relation', many: true });
    expect(relationTypes(tasks ?? { target: null })).toEqual(['task']);
    const decisions = meeting?.properties.find((property) => property.key === 'decisions');
    expect(relationTypes(decisions ?? { target: null })).toEqual(['decision']);
    expect(ensured.properties.gained).toEqual([
      { path: '.atlas/types/meeting.md', label: 'Meeting', added: ['Tasks', 'Decisions'] },
    ]);
    expect(ensured.properties.failed).toEqual([]);
    // Only PARA's project is left to ask about: the shipped keys are no longer offered.
    expect(ensured.offer.extensions.map((extension) => extensionKeys(extension))).toEqual([
      new Set(['project']),
    ]);
  });

  it('records what it settled in the vault’s migrations, so the other Mac knows', async () => {
    const v = vault({ '.atlas/types/meeting.md': OLDER_MEETING });

    await ensureBuiltInTypes(v);

    const record = v.files.get(RECORD) ?? '';
    expect(record).toMatch(/^---\natlas: migration\n---\n/);
    expect(record).toContain('"added":{"meeting":["tasks","decisions"]}');
  });

  it('leaves a property the person changed as it is, even where it differs from what Atlas ships', async () => {
    const theirs = { kind: 'text', label: 'To-dos' };
    const v = vault({
      '.atlas/types/meeting.md': note({
        name: 'meeting',
        label: 'Meeting',
        properties: {
          tasks: theirs,
          atlas_import_outcome: 'text',
          atlas_import_error: 'text',
          atlas_duplicate_of: 'text',
        },
      }),
    });

    const ensured = await ensureBuiltInTypes(v);

    const properties = propertiesOf(v, '.atlas/types/meeting.md');
    expect(properties['tasks']).toEqual(theirs);
    expect(properties['atlas_duplicate_of']).toBe('text');
    expect(Object.keys(properties)).toEqual([
      'tasks',
      'atlas_import_outcome',
      'atlas_import_error',
      'atlas_duplicate_of',
      'decisions',
    ]);
    expect(ensured.properties.gained.map((gained) => gained.added)).toEqual([['Decisions']]);
  });

  it('changes nothing when the vault is opened again', async () => {
    const v = vault({ '.atlas/types/meeting.md': OLDER_MEETING });
    await ensureBuiltInTypes(v);
    const once = new Map(v.files);

    const again = await ensureBuiltInTypes(v);

    expect(v.files).toEqual(once);
    expect(again.properties).toEqual({ gained: [], skipped: [], failed: [] });
  });

  it('never puts back a property the person took off after it was added', async () => {
    const v = vault({ '.atlas/types/meeting.md': OLDER_MEETING });
    await ensureBuiltInTypes(v);
    const without = note({ name: 'meeting', label: 'Meeting', properties: { title: 'text' } });
    v.files.set('.atlas/types/meeting.md', without);

    const again = await ensureBuiltInTypes(v);

    expect(v.files.get('.atlas/types/meeting.md')).toBe(without);
    expect(again.properties.gained).toEqual([]);
  });

  it('gives every built-in type file what Atlas ships on it, not only Meeting', async () => {
    const v = vault({
      '.atlas/types/daily.md': note({ name: 'daily', properties: { date: 'date' } }),
      '.atlas/types/decision.md': note({ name: 'decision', label: 'Decision' }),
    });

    const ensured = await ensureBuiltInTypes(v);

    expect(Object.keys(propertiesOf(v, '.atlas/types/daily.md'))).toEqual(['date', 'tags']);
    expect(Object.keys(propertiesOf(v, '.atlas/types/decision.md'))).not.toHaveLength(0);
    expect(ensured.properties.gained.map((gained) => gained.path)).toEqual([
      '.atlas/types/daily.md',
      '.atlas/types/decision.md',
    ]);
  });

  it('leaves a type of the vault’s own alone, and PARA’s and Task’s, which stay an offer', async () => {
    const recipe = note({ name: 'recipe', properties: { serves: 'number' } });
    const theirs = {
      '.atlas/types/recipe.md': recipe,
      '.atlas/types/task.md': JAMES_TASK,
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/resource.md': note({ name: 'resource', properties: { shelf: 'text' } }),
      '.atlas/types/area.md': note({ name: 'area' }),
    };
    const v = vault(theirs);

    const ensured = await ensureBuiltInTypes(v);

    for (const [path, text] of Object.entries(theirs)) expect(v.files.get(path)).toBe(text);
    expect(ensured.properties).toEqual({ gained: [], skipped: [], failed: [] });
    expect(v.files.has(RECORD)).toBe(false);
  });

  it('never touches a vault’s own Resource type, even where the vault files by project', async () => {
    const resource = note({ name: 'resource', label: 'Reference', properties: { shelf: 'text' } });
    const v = vault({
      '.atlas/types/project.md': JAMES_PROJECT,
      '.atlas/types/resource.md': resource,
    });

    await ensureBuiltInTypes(v);

    expect(v.files.get('.atlas/types/resource.md')).toBe(resource);
    expect(v.files.get('.atlas/types/project.md')).toBe(JAMES_PROJECT);
  });

  it('settles a Meeting type found complete, so a key taken off afterwards stays off', async () => {
    const shipped = {
      atlas_import_outcome: 'select',
      atlas_import_error: 'text',
      atlas_duplicate_of: { kind: 'relation', target: 'meeting' },
      tasks: { kind: 'relation', target: 'task', many: true },
      decisions: { kind: 'relation', target: 'decision', many: true },
    };
    const complete = note({ name: 'meeting', label: 'Meeting', properties: shipped });
    const v = vault({ '.atlas/types/meeting.md': complete });

    const opened = await ensureBuiltInTypes(v);

    expect(opened.properties).toEqual({ gained: [], skipped: [], failed: [] });
    expect(v.files.get('.atlas/types/meeting.md')).toBe(complete);
    const record = v.files.get(RECORD) ?? '';
    expect(record).toContain(`"settled":{"meeting":${JSON.stringify(Object.keys(shipped))}}`);
    expect(record).toContain('"added":{}');

    const rest = Object.fromEntries(Object.entries(shipped).filter(([key]) => key !== 'tasks'));
    const without = note({ name: 'meeting', label: 'Meeting', properties: rest });
    v.files.set('.atlas/types/meeting.md', without);
    const reopened = await ensureBuiltInTypes(v);

    expect(reopened.properties.gained).toEqual([]);
    expect(v.files.get('.atlas/types/meeting.md')).toBe(without);
  });

  it('does not report a key as added when the file declares it in a shape Atlas cannot read', async () => {
    const unread = note({
      name: 'meeting',
      label: 'Meeting',
      properties: { tasks: { kind: 'relation' } },
    });
    const v = vault({ '.atlas/types/meeting.md': unread });

    const ensured = await ensureBuiltInTypes(v);

    expect(propertiesOf(v, '.atlas/types/meeting.md')['tasks']).toEqual({ kind: 'relation' });
    expect(ensured.properties.gained.map((gained) => gained.added)).toEqual([
      ['Import', 'Import error', 'Duplicate of', 'Decisions'],
    ]);
    expect(v.files.get(RECORD) ?? '').toContain('"added":{"meeting":["atlas_import_outcome"');
    expect(v.files.get(RECORD) ?? '').not.toMatch(/"added":\{"meeting":\[[^\]]*"tasks"/);
  });

  it('is not thrown by a type named `constructor`, in the vault or in its record', async () => {
    const odd = note({ name: 'constructor', properties: { serves: 'number' } });
    const v = vault({
      '.atlas/types/constructor.md': odd,
      '.atlas/types/meeting.md': OLDER_MEETING,
      [RECORD]: '---\natlas: migration\n---\n\n```json\n{"settled":{"constructor":["x"]}}\n```\n',
    });

    const ensured = await ensureBuiltInTypes(v);

    expect(v.files.get('.atlas/types/constructor.md')).toBe(odd);
    expect(ensured.properties.failed).toEqual([]);
    expect(ensured.properties.gained.map((gained) => gained.label)).toEqual(['Meeting']);
  });

  it('writes nothing when its record cannot be read, and says so', async () => {
    const v = vault({
      '.atlas/types/meeting.md': OLDER_MEETING,
      [RECORD]: '---\natlas: migration\n---\n\nNot a record any more.\n',
    });

    const ensured = await ensureBuiltInTypes(v);

    expect(v.files.get('.atlas/types/meeting.md')).toBe(OLDER_MEETING);
    expect(ensured.properties.gained).toEqual([]);
    expect(ensured.properties.failed).toHaveLength(1);
  });

  it('adds to its record when a built-in type turns up later, keeping what it settled', async () => {
    const v = vault({ '.atlas/types/meeting.md': OLDER_MEETING });
    await ensureBuiltInTypes(v);
    v.files.set('.atlas/types/daily.md', note({ name: 'daily', properties: { date: 'date' } }));

    const later = await ensureBuiltInTypes(v);

    expect(later.properties.gained.map((gained) => gained.label)).toEqual(['daily']);
    const record = v.files.get(RECORD) ?? '';
    expect(record).toContain('"added":{"meeting":["tasks","decisions"],"daily":["tags"]}');
    expect(record.match(/# Properties added to built-in types/g)).toHaveLength(1);
  });

  it('says so when its record cannot be written, and keeps the properties it added', async () => {
    const v = vault({ '.atlas/types/meeting.md': OLDER_MEETING });
    const refusing = {
      ...v.fs,
      createNote: async () => {
        throw new Error('read-only vault');
      },
    };

    const ensured = await ensureBuiltInTypes({ ...v, fs: refusing });

    expect(ensured.properties.failed).toEqual([{ name: 'its record', reason: 'read-only vault' }]);
    expect(ensured.properties.gained.map((gained) => gained.label)).toEqual(['Meeting']);
    expect(Object.keys(propertiesOf(v, '.atlas/types/meeting.md'))).toContain('tasks');
  });

  it('settles only the types it could write, so one that failed is tried again next time', async () => {
    const v = vault({ '.atlas/types/meeting.md': OLDER_MEETING });
    const refusing = {
      ...v.fs,
      writeTextFile: async (args: { path: VaultPath; contents: string }) => {
        if (args.path.endsWith('meeting.md')) throw new Error('the disk is full');
        return v.fs.writeTextFile({ ...args, expectedModified: null });
      },
    };

    const failed = await ensureBuiltInTypes({ ...v, fs: refusing });
    expect(failed.properties.failed).toEqual([{ name: 'Meeting', reason: 'the disk is full' }]);
    expect(v.files.get('.atlas/types/meeting.md')).toBe(OLDER_MEETING);

    const retried = await ensureBuiltInTypes(v);
    expect(retried.properties.gained.map((gained) => gained.label)).toEqual(['Meeting']);
    expect(Object.keys(propertiesOf(v, '.atlas/types/meeting.md'))).toContain('tasks');
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
      'tasks',
      'decisions',
    ]);
    expect(relationTypes(widened?.properties[0] ?? { target: null })).toEqual(['project', 'area']);
  });
});

describe('ensureBuiltInTypes, called again while it runs', () => {
  const MEETING = note({ name: 'meeting', label: 'Meeting', properties: { title: 'text' } });

  it('answers a second call for the same vault with the run under way', async () => {
    const v = vault({ '.atlas/types/meeting.md': MEETING });
    const first = ensureBuiltInTypes({ ...v, vault: '/mara' });
    const second = ensureBuiltInTypes({ ...v, vault: '/mara' });
    expect(second).toBe(first);
    expect((await first).properties.gained).toHaveLength(1);
  });

  it('runs again for another vault, and once the run is over', async () => {
    const v = vault({ '.atlas/types/meeting.md': MEETING });
    const mara = ensureBuiltInTypes({ ...v, vault: '/mara' });
    const tobias = ensureBuiltInTypes({ ...v, vault: '/tobias' });
    expect(tobias).not.toBe(mara);
    await Promise.all([mara, tobias]);
    const later = ensureBuiltInTypes({ ...v, vault: '/mara' });
    expect(later).not.toBe(mara);
    expect((await later).properties).toEqual({ gained: [], skipped: [], failed: [] });
  });
});
