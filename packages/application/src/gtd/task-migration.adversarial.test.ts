/**
 * Adversarial pass on P30-02 (ADR-0029): the migration's record across a run
 * cut off and picked up again, the rules it writes tasks under, and an
 * automation that sets a task's status. Same in-memory, JSON-frontmatter
 * vault as `task-migration.test.ts`. Each test names one invariant.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type AutomationRule } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { runAutomation } from '../automations/run-automation.ts';
import type { VaultGuard } from '../automations/vault-guard.ts';
import { runTaskMigration, undoTaskMigration, type MigrationPanes } from './run-task-migration.ts';
import { previewTaskMigration, type TaskMigrationPorts } from './task-migration.ts';

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

/** A vault whose Task type already follows GTD, so only the tasks move. */
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
    filed_under: { kind: 'relation', target: 'project' },
  },
});

const MODIFIED = Date.UTC(2026, 8, 30, 12);

function vault(files: Record<string, string>) {
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
  return { ports, files: memory.files };
}

const closedPanes: MigrationPanes = { state: () => 'closed', reload: () => {} };
const clock = { localNow: () => '2026-10-08T09:30:00' };

const frontmatterOf = (text: string | undefined) =>
  JSON.parse((text ?? '').split('\n')[1] ?? '{}') as Record<string, unknown>;

describe('undo after a run cut off partway and picked up again', () => {
  it('keeps what the person wrote to a task between the two runs, when the first never wrote it', async () => {
    const files = {
      '.atlas/types/task.md': GTD_TYPE,
      'tasks/Ship it.md': note({ type: 'task', status: 'done' }),
      'tasks/Draft the memo.md': note({ type: 'task', status: 'doing' }),
    };
    const { ports, files: disk } = vault(files);
    let failing = true;
    const writeTextFile = ports.fs.writeTextFile;
    const flaky: TaskMigrationPorts = {
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

    await runTaskMigration({
      ports: flaky,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(flaky),
    });
    // The first run never wrote the memo. Mara gives it a due date by hand.
    const edited = note({ type: 'task', status: 'doing', due: '2026-11-01' });
    disk.set('tasks/Draft the memo.md', edited);

    failing = false;
    await runTaskMigration({
      ports: flaky,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(flaky),
    });
    expect(frontmatterOf(disk.get('tasks/Draft the memo.md'))).toEqual({
      type: 'task',
      status: 'in-progress',
      due: '2026-11-01',
    });

    await undoTaskMigration({ fs: flaky.fs, panes: closedPanes });
    // Undo takes back what the migration did — the status — and nothing Mara wrote.
    expect(disk.get('tasks/Draft the memo.md')).toBe(edited);
  });
});

describe('the migration under the task rules', () => {
  it('never leaves a task Waiting with nobody to wait on', async () => {
    // `Waiting`, as typed by hand, is read as GTD's waiting — but nobody is
    // in `waiting_on`, which every other write refuses (ADR-0029).
    const { ports, files } = vault({
      '.atlas/types/task.md': GTD_TYPE,
      'tasks/Hear back.md': note({ type: 'task', status: 'Waiting' }),
    });
    await runTaskMigration({
      ports,
      panes: closedPanes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    const after = frontmatterOf(files.get('tasks/Hear back.md'));
    expect(after['status'] === 'waiting' && after['waiting_on'] === undefined).toBe(false);
  });
});

describe('an automation that sets a task’s status', () => {
  const TODAY = '2026-10-08';
  const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T03:00:00` };
  const GUARD: VaultGuard = { vault: '/vaults/home', currentVault: () => '/vaults/home' };
  const rule = (values: Record<string, unknown>): AutomationRule => ({
    id: 'Close',
    path: createVaultPath('.atlas/automations/Close.md'),
    name: 'Close out next actions',
    enabled: true,
    when: { kind: 'daily', at: '03:00' },
    which: 'FROM task WHERE status = next-action',
    olderThanDays: null,
    action: { kind: 'set', values },
  });
  const run = async (values: Record<string, unknown>) => {
    const tasks = automationVault({
      today: TODAY,
      notes: { 'Call Tobias.md': jsonNote({ type: 'task', status: 'next-action' }) },
    });
    await runAutomation({
      ports: tasks.ports,
      rule: rule(values),
      clock: CLOCK,
      activity: recordingActivity(),
      guard: GUARD,
      trigger: 'hand',
    });
    return tasks.properties('Call Tobias.md');
  };

  it('dates a task it sets to Archive', async () => {
    expect(await run({ status: 'archive' })).toMatchObject({ status: 'archive', completed: TODAY });
  });

  it('never sets a task Waiting with nobody to wait on', async () => {
    expect(await run({ status: 'waiting' })).not.toMatchObject({ status: 'waiting' });
  });
});
