/**
 * Adversarial pass, round 2, on P30-02 (ADR-0029): the Inbox's quick look
 * (`taskMigrationNeeded`) against what a fresh preview would still do, and a
 * view that leaves an old status out, rewritten over a status tasks already
 * hold. Same in-memory, JSON-frontmatter vault as `task-migration.test.ts`.
 * Each test names one invariant.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { runTaskMigration, type MigrationPanes } from './run-task-migration.ts';
import {
  hasMigrationWork,
  previewTaskMigration,
  taskMigrationNeeded,
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

const note = (frontmatter: unknown, body = '\n# Mine\n') =>
  `---\n${JSON.stringify(frontmatter)}\n---\n${body}`;

const frontmatterOf = (text: string) =>
  JSON.parse(text.split('\n')[1] ?? '{}') as Record<string, unknown>;

const GTD_STATUSES = [
  'inbox',
  'backlog',
  'next-action',
  'in-progress',
  'waiting',
  'someday',
  'longterm',
  'archive',
];

/** The board the vault ran on before GTD. */
const OLD_TASK_TYPE = note({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'next', 'doing', 'review', 'done'] },
  },
});

/** A Task type already GTD's, with every key GTD reads. */
const GTD_TYPE = note({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: GTD_STATUSES, done: 'archive' },
    waiting_on: { kind: 'relation', target: 'person' },
    contexts: 'multiSelect',
    defer: 'date',
    due: 'date',
    estimate: 'number',
    completed: 'date',
    source: 'text',
  },
});

const MODIFIED = Date.UTC(2026, 8, 30, 12);

/** The vault, its index answering both the tasks of a type and the statuses query from the files. */
function vault(files: Record<string, string>, overrides: Partial<VaultFsPort> = {}) {
  const memory = memoryVault(files);
  const markdown = jsonFrontmatter();
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
  const indexedTasks = () =>
    [...memory.files].filter(
      ([path, text]) => !path.startsWith('.atlas/') && frontmatterOf(text)['type'] === 'task',
    );
  const index = fakeIndexPort({
    notesOfType: async (type) =>
      indexedTasks()
        .filter(([, text]) => frontmatterOf(text)['type'] === type)
        .map(([path]) => ({ path, title: path })),
    query: async () => ({
      columns: ['status'],
      rows: indexedTasks().map(([, text]) => [
        (frontmatterOf(text)['status'] as string | undefined) ?? null,
      ]),
      truncated: false,
    }),
  });
  const ports: TaskMigrationPorts = { fs, markdown, index, dayOf: () => '2026-09-30' };
  return { ports, files: memory.files };
}

/** The host making the record but stopping at the first GTD view, as a run cut off there would. */
const refuseViews =
  (fs: VaultFsPort): VaultFsPort['createNote'] =>
  async (args) => {
    if (args.path.startsWith('.atlas/views/')) throw new Error('Atlas quit');
    return fs.createNote(args);
  };

const clock = { localNow: () => '2026-10-08T09:30:00' };
const panesWithUnsaved = (path: string): MigrationPanes => ({
  state: (at) => (at === path ? 'dirty' : 'closed'),
  reload: () => {},
});

describe('the Inbox’s quick look after a run that left something', () => {
  // A run leaves a file for unsaved typing, or the host refusing it, and
  // says "run it again". The quick look is what decides whether the Inbox
  // ever offers that again: it must say yes while a preview has work.
  it.each([
    ['a view it could not write for unsaved typing', '.atlas/views/Doing.md'],
    ['the task template it could not write for unsaved typing', '.atlas/templates/Task.md'],
  ])('says yes while %s is still to move', async (_, left) => {
    const { ports } = vault({
      '.atlas/types/task.md': OLD_TASK_TYPE,
      '.atlas/templates/Task.md': note({ type: 'task', status: 'doing' }),
      '.atlas/views/Doing.md': note({ atlas: 'view', query: 'FROM task WHERE status = doing' }),
      'tasks/Draft the memo.md': note({ type: 'task', status: 'doing' }),
      'tasks/Ship it.md': note({ type: 'task', status: 'done', completed: '2026-09-01' }),
    });
    const report = await runTaskMigration({
      ports,
      panes: panesWithUnsaved(left),
      clock,
      preview: await previewTaskMigration(ports),
    });
    expect(report.left.map((file) => file.path)).toEqual([left]);

    // Premise: a fresh preview still has the left file to move.
    expect(hasMigrationWork(await previewTaskMigration(ports))).toBe(true);
    expect(await taskMigrationNeeded(ports)).toBe(true);
  });

  it('says yes while the GTD views a run cut off before adding are still to be added', async () => {
    // Views are added last: a run stopped after its edits leaves the type and
    // every task GTD's, its record on disk, and no Inbox or Waiting view.
    const { ports } = vault({
      '.atlas/types/task.md': OLD_TASK_TYPE,
      'tasks/Draft the memo.md': note({ type: 'task', status: 'doing' }),
    });
    await runTaskMigration({
      ports: { ...ports, fs: { ...ports.fs, createNote: refuseViews(ports.fs) } },
      panes: { state: () => 'closed', reload: () => {} },
      clock,
      preview: await previewTaskMigration(ports),
    });

    // Premise: a fresh preview offers the views the run never added.
    expect((await previewTaskMigration(ports)).views.length).toBeGreaterThan(0);
    expect(await taskMigrationNeeded(ports)).toBe(true);
  });

  it('says yes while a task is Waiting with nobody to wait on, which a preview sends to the Inbox', async () => {
    // Every status is one of the eight, so the quick look says no — yet the
    // preview holds this task (`held`) and moves it, as ADR-0029 says the
    // migration never leaves what the rules refuse. A source, or the other
    // Mac, writes such a task without the rules.
    const { ports, files } = vault({
      '.atlas/types/task.md': OLD_TASK_TYPE,
      'tasks/Draft the memo.md': note({ type: 'task', status: 'doing' }),
    });
    await runTaskMigration({
      ports,
      panes: { state: () => 'closed', reload: () => {} },
      clock,
      preview: await previewTaskMigration(ports),
    });
    expect(await taskMigrationNeeded(ports)).toBe(false);
    files.set('tasks/Hear from Mara Quill.md', note({ type: 'task', status: 'waiting' }));
    const preview = await previewTaskMigration(ports);
    expect(preview.tasks.map((task) => task.held !== null)).toEqual([true]);
    expect(await taskMigrationNeeded(ports)).toBe(true);
  });
});

describe('a view that leaves an old status out', () => {
  it('is listed, not rewritten, when tasks already hold the status it would become', async () => {
    // Synced in from a Mac that had not moved: `doing` beside tasks already
    // `in-progress`. `status != doing` lists Call the bank today; rewritten to
    // `status != in-progress`, it silently drops it.
    const { ports } = vault({
      '.atlas/types/task.md': GTD_TYPE,
      '.atlas/views/Not doing.md': note({
        atlas: 'view',
        query: 'FROM task WHERE status != doing',
      }),
      'tasks/Draft the memo.md': note({ type: 'task', status: 'doing' }),
      'tasks/Call the bank.md': note({ type: 'task', status: 'in-progress' }),
    });
    const preview = await previewTaskMigration(ports);
    expect(preview.references.map((reference) => reference.path)).not.toContain(
      '.atlas/views/Not doing.md',
    );
    expect(preview.listed.map((reference) => reference.path)).toContain(
      '.atlas/views/Not doing.md',
    );
  });
});
