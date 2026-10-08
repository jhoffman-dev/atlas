/**
 * P30-02: moving a vault's tasks to GTD's eight statuses — previewed, run as
 * one record, undone byte for byte, run again after stopping partway — over
 * a vault in memory whose frontmatter is JSON, so what each file says can be
 * read back whole. How the real writer keeps every byte of YAML is the
 * adapters' integration test.
 */
import { describe, expect, it } from 'vitest';
import { MIGRATION_RECORD_PATH, createVaultPath, type VaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import {
  readMigrationRecord,
  runTaskMigration,
  undoTaskMigration,
  type MigrationPanes,
} from './run-task-migration.ts';
import {
  hasMigrationWork,
  previewTaskMigration,
  type TaskMigrationPorts,
} from './task-migration.ts';

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

/** The old board's Task type, with a property of James's own. */
const OLD_TASK_TYPE = note(
  {
    name: 'task',
    label: 'Task',
    properties: {
      status: {
        kind: 'select',
        options: ['backlog', 'next', 'doing', 'review', 'done'],
        done: 'done',
      },
      phase: 'number',
      due: 'date',
    },
  },
  '\n# Task\n\nThe board this vault ran on.\n',
);

const FILES: Record<string, string> = {
  '.atlas/types/task.md': OLD_TASK_TYPE,
  '.atlas/types/person.md': note({ name: 'person', label: 'Person', properties: {} }),
  '.atlas/templates/Task.md': note({ type: 'task', status: 'doing' }, '\n# \n'),
  '.atlas/views/Roadmap.md': note({
    atlas: 'view',
    type: 'task',
    filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
  }),
  '.atlas/views/Odd.md': note({ atlas: 'view', query: 'FROM task WHERE status CONTAINS do' }),
  '.atlas/automations/Tidy.md': note({
    atlas: 'automation',
    name: 'Tidy',
    which: 'FROM task WHERE status = done',
    do: 'archive',
  }),
  'tasks/Write the brief.md': note({ type: 'task', status: 'backlog' }),
  'tasks/Call Mara.md': note({ type: 'task', status: 'next', phase: 3 }),
  'tasks/Draft the memo.md': note({ type: 'task', status: 'doing' }),
  'tasks/Check figures.md': note({ type: 'task', status: 'review' }),
  'tasks/Ship it.md': note({ type: 'task', status: 'done' }),
  'tasks/Shipped earlier.md': note({ type: 'task', status: 'done', completed: '2026-01-02' }),
  'tasks/Odd one.md': note({ type: 'task', status: 'blocked' }),
  'notes/Not a task.md': note({ status: 'done' }),
};

const MODIFIED = Date.UTC(2026, 8, 30, 12);

function vault(files: Record<string, string> = FILES, overrides: Partial<VaultFsPort> = {}) {
  const memory = memoryVault(files);
  const fs = fakeVaultFs({
    ...memory.fs,
    listNotes: async () =>
      [...memory.files.keys()].map((path) => ({
        name: path.split('/').at(-1) ?? path,
        path: createVaultPath(path),
        modified: MODIFIED,
        size: 1,
      })),
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: MODIFIED, size: text.length }];
      }),
    ...overrides,
  });
  const markdown = jsonFrontmatter();
  const index = fakeIndexPort({
    notesOfType: async (type) =>
      [...memory.files]
        .filter(
          ([path, text]) =>
            !path.startsWith('.atlas/') &&
            markdown.frontmatterProperties(text.split('\n---\n')[0] + '\n---\n')['type'] === type,
        )
        .map(([path]) => ({ path, title: path })),
  });
  const ports: TaskMigrationPorts = { fs, markdown, index, dayOf: () => '2026-09-30' };
  return { ports, files: memory.files, trashed: memory.trashed };
}

const closedPanes: MigrationPanes = { state: () => 'closed', reload: () => {} };
const clock = { localNow: () => '2026-10-08T09:30:00' };

const frontmatterOf = (text: string | undefined) =>
  JSON.parse((text ?? '').split('\n')[1] ?? '{}') as Record<string, unknown>;

describe('previewTaskMigration', () => {
  it('lists every task old → new, a finished one dated by its last change', async () => {
    const { ports } = vault();
    const preview = await previewTaskMigration(ports);
    expect(
      preview.tasks.map(({ title, from, to, completed }) => [title, from, to, completed]),
    ).toEqual(
      expect.arrayContaining([
        ['Call Mara', 'next', 'next-action', null],
        ['Draft the memo', 'doing', 'in-progress', null],
        ['Check figures', 'review', 'in-progress', null],
        ['Ship it', 'done', 'archive', '2026-09-30'],
        ['Shipped earlier', 'done', 'archive', null],
        ['Odd one', 'blocked', 'inbox', null],
        ['Task', 'doing', 'in-progress', null],
      ]),
    );
    // Backlog stays backlog, so it is not listed; nor is a note that is not a task.
    expect(preview.tasks).toHaveLength(7);
  });

  it('offers the mapping for every old status, the type’s own included', async () => {
    const { ports } = vault();
    const preview = await previewTaskMigration(ports);
    // Backlog is a GTD status already, so it is not asked about.
    expect(Object.fromEntries(preview.mapping)).toEqual({
      next: 'next-action',
      doing: 'in-progress',
      review: 'in-progress',
      done: 'archive',
      blocked: 'inbox',
    });
  });

  it('says what changes in the Task type, which views and rules move, which are listed, and the views added', async () => {
    const { ports } = vault();
    const preview = await previewTaskMigration(ports);
    expect(preview.type?.path).toBe('.atlas/types/task.md');
    expect(preview.type?.lines[0]).toMatch(/^Status becomes Inbox, Backlog, Next Action/);
    expect(preview.references).toHaveLength(2);
    expect(preview.references).toEqual(
      expect.arrayContaining([
        { path: '.atlas/views/Roadmap.md', title: 'Roadmap', moved: ['done → archive'] },
        { path: '.atlas/automations/Tidy.md', title: 'Tidy', moved: ['done → archive'] },
      ]),
    );
    expect(preview.listed.map((listed) => listed.path)).toEqual(['.atlas/views/Odd.md']);
    expect(preview.views).toEqual([
      '.atlas/views/Inbox.md',
      '.atlas/views/Next actions.md',
      '.atlas/views/Waiting.md',
      '.atlas/views/Someday and Longterm.md',
    ]);
  });

  it('takes the person’s own choice for an old status', async () => {
    const { ports } = vault();
    const preview = await previewTaskMigration(ports, new Map([['blocked', 'someday']]));
    expect(preview.tasks.find((task) => task.title === 'Odd one')?.to).toBe('someday');
  });

  it('adds the Task type to a vault that has none', async () => {
    const { ports } = vault({ 'tasks/A.md': note({ type: 'task', status: 'done' }) });
    const preview = await previewTaskMigration(ports);
    expect(preview.type).toEqual({
      path: '.atlas/types/task.md',
      lines: ['Adds the Task type, with the eight statuses.'],
    });
  });
});

describe('runTaskMigration', () => {
  it('rewrites each file’s frontmatter alone, records the run, and adds the GTD views', async () => {
    const { ports, files } = vault();
    const report = await runTaskMigration({
      ports,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    expect(report.left).toEqual([]);
    expect(frontmatterOf(files.get('tasks/Ship it.md'))).toEqual({
      type: 'task',
      status: 'archive',
      completed: '2026-09-30',
    });
    expect(frontmatterOf(files.get('tasks/Call Mara.md'))).toEqual({
      type: 'task',
      status: 'next-action',
      phase: 3,
    });
    expect(files.get('tasks/Call Mara.md')).toMatch(/\n---\n\n# Mine\n\nKept \*exactly\*\.\n$/);
    expect(frontmatterOf(files.get('.atlas/templates/Task.md'))['status']).toBe('in-progress');
    expect(frontmatterOf(files.get('.atlas/automations/Tidy.md'))['which']).toBe(
      'FROM task WHERE status = archive',
    );
    expect(files.get('.atlas/views/Odd.md')).toBe(FILES['.atlas/views/Odd.md']);
    expect(files.get('notes/Not a task.md')).toBe(FILES['notes/Not a task.md']);
    const type = frontmatterOf(files.get('.atlas/types/task.md'));
    expect(type['properties']).toMatchObject({
      status: {
        options: [
          'inbox',
          'backlog',
          'next-action',
          'in-progress',
          'waiting',
          'someday',
          'longterm',
          'archive',
        ],
        done: 'archive',
      },
      phase: 'number',
      waiting_on: { kind: 'relation', target: 'person' },
    });
    expect(files.has('.atlas/views/Next actions.md')).toBe(true);
    expect((await readMigrationRecord(ports.fs))?.record.files).toHaveLength(report.written.length);
  });

  it('is idempotent: once run, there is nothing left to do', async () => {
    const { ports, files } = vault();
    await runTaskMigration({
      ports,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    const after = new Map(files);
    const again = await previewTaskMigration(ports);
    expect(hasMigrationWork(again)).toBe(false);
    expect(await runTaskMigration({ ports, panes: closedPanes, clock, preview: again })).toEqual({
      written: [],
      left: [],
    });
    expect(new Map(files)).toEqual(after);
  });

  it('touches only what the preview showed', async () => {
    const { ports, files } = vault();
    const preview = await previewTaskMigration(ports);
    files.set('tasks/Added since.md', note({ type: 'task', status: 'doing' }));
    await runTaskMigration({ ports, panes: closedPanes, clock, preview });
    expect(frontmatterOf(files.get('tasks/Added since.md'))['status']).toBe('doing');
  });

  it('works a task out again from what it says now', async () => {
    const { ports, files } = vault();
    const preview = await previewTaskMigration(ports);
    files.set(
      'tasks/Draft the memo.md',
      note({ type: 'task', status: 'done', completed: '2026-10-01' }),
    );
    await runTaskMigration({ ports, panes: closedPanes, clock, preview });
    expect(frontmatterOf(files.get('tasks/Draft the memo.md'))).toEqual({
      type: 'task',
      status: 'archive',
      completed: '2026-10-01',
    });
  });

  it('never writes a note with unsaved typing in a pane, and reads a shown one again', async () => {
    const { ports, files } = vault();
    const reloaded: VaultPath[] = [];
    const panes: MigrationPanes = {
      state: (path) =>
        path === 'tasks/Call Mara.md' ? 'dirty' : path === 'tasks/Ship it.md' ? 'clean' : 'closed',
      reload: (path) => reloaded.push(path),
    };
    const report = await runTaskMigration({
      ports,
      panes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    expect(report.left).toEqual([
      { path: 'tasks/Call Mara.md', reason: expect.stringContaining('unsaved typing') },
    ]);
    expect(files.get('tasks/Call Mara.md')).toBe(FILES['tasks/Call Mara.md']);
    expect(reloaded).toEqual(['tasks/Ship it.md']);
  });

  it('refuses to start over a record it cannot read, writing nothing', async () => {
    const { ports, files } = vault({ ...FILES, [MIGRATION_RECORD_PATH]: '# not a record\n' });
    const preview = await previewTaskMigration(ports);
    await expect(runTaskMigration({ ports, panes: closedPanes, clock, preview })).rejects.toThrow(
      /record cannot be read/,
    );
    expect(files.get('tasks/Ship it.md')).toBe(FILES['tasks/Ship it.md']);
  });
});

describe('undoing the migration', () => {
  it('puts every file back byte for byte, takes away what it added, and its record', async () => {
    const { ports, files, trashed } = vault();
    await runTaskMigration({
      ports,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    expect(new Map(files)).not.toEqual(new Map(Object.entries(FILES)));

    const undone = await undoTaskMigration({ fs: ports.fs, panes: closedPanes });
    expect(undone?.left).toEqual([]);
    expect(new Map(files)).toEqual(new Map(Object.entries(FILES)));
    expect(trashed).toContain(MIGRATION_RECORD_PATH);
    expect(await undoTaskMigration({ fs: ports.fs, panes: closedPanes })).toBeNull();
  });

  it('keeps a body edited since, and leaves a file whose frontmatter changed since', async () => {
    const { ports, files } = vault();
    await runTaskMigration({
      ports,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    files.set('tasks/Call Mara.md', (files.get('tasks/Call Mara.md') ?? '') + 'More.\n');
    files.set('tasks/Ship it.md', note({ type: 'task', status: 'next-action' }));
    files.set('.atlas/views/Waiting.md', 'mine now');

    const undone = await undoTaskMigration({ fs: ports.fs, panes: closedPanes });
    expect(files.get('tasks/Call Mara.md')).toBe(`${FILES['tasks/Call Mara.md']}More.\n`);
    expect(undone?.left.map((left) => left.path).sort()).toEqual([
      '.atlas/views/Waiting.md',
      'tasks/Ship it.md',
    ]);
    expect(files.get('.atlas/views/Waiting.md')).toBe('mine now');
    expect(files.has(MIGRATION_RECORD_PATH)).toBe(false);
  });

  it('keeps the record for what a second try could still put back', async () => {
    const { ports, files } = vault();
    await runTaskMigration({
      ports,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    const typing: MigrationPanes = {
      state: (path) => (path === 'tasks/Call Mara.md' ? 'dirty' : 'closed'),
      reload: () => {},
    };
    const first = await undoTaskMigration({ fs: ports.fs, panes: typing });
    expect(first?.left).toEqual([
      { path: 'tasks/Call Mara.md', reason: expect.stringContaining('unsaved typing') },
    ]);
    expect((await readMigrationRecord(ports.fs))?.record.files.map((file) => file.path)).toEqual([
      'tasks/Call Mara.md',
    ]);

    await undoTaskMigration({ fs: ports.fs, panes: closedPanes });
    expect(new Map(files)).toEqual(new Map(Object.entries(FILES)));
  });
});

describe('a run cut off partway', () => {
  it('has its record written before it changes any file, so a run that dies can still be undone', async () => {
    const { ports, files } = vault();
    const recordedFirst: boolean[] = [];
    const watched = {
      ...ports,
      fs: {
        ...ports.fs,
        writeTextFile: async (args: Parameters<VaultFsPort['writeTextFile']>[0]) => {
          recordedFirst.push(files.has(MIGRATION_RECORD_PATH));
          return ports.fs.writeTextFile(args);
        },
      },
    };
    await runTaskMigration({
      ports: watched,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(watched),
    });
    expect(recordedFirst.length).toBeGreaterThan(5);
    expect(recordedFirst.every(Boolean)).toBe(true);
  });

  it('reports what it could not write, picks up the rest when run again, and undoes both as one', async () => {
    let failing = true;
    const { ports, files } = vault(FILES);
    const writeTextFile = ports.fs.writeTextFile;
    const flaky = {
      ...ports,
      fs: {
        ...ports.fs,
        writeTextFile: async (args: Parameters<VaultFsPort['writeTextFile']>[0]) => {
          if (failing && args.path === 'tasks/Draft the memo.md')
            throw new Error('The disk is full.');
          return writeTextFile(args);
        },
      },
    };

    const first = await runTaskMigration({
      ports: flaky,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(flaky),
    });
    expect(first.left).toEqual([{ path: 'tasks/Draft the memo.md', reason: 'The disk is full.' }]);
    expect(frontmatterOf(files.get('tasks/Ship it.md'))['status']).toBe('archive');

    failing = false;
    const rest = await previewTaskMigration(flaky);
    expect(rest.tasks.map((task) => task.title)).toEqual(['Draft the memo']);
    expect(rest.type).toBeNull();
    const second = await runTaskMigration({
      ports: flaky,
      panes: closedPanes,
      clock: { localNow: () => 'later' },
      preview: rest,
    });
    expect(second).toEqual({ written: ['tasks/Draft the memo.md'], left: [] });
    expect((await readMigrationRecord(flaky.fs))?.record.at).toBe('2026-10-08T09:30:00');

    await undoTaskMigration({ fs: flaky.fs, panes: closedPanes });
    expect(new Map(files)).toEqual(new Map(Object.entries(FILES)));
  });
});
