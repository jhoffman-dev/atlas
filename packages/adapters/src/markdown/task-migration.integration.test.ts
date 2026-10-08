/**
 * P30-02 (integration): the GTD status migration over a copy of this
 * repository's own vault — its 85 task cards, its Task type, its views and
 * templates — written by the real YAML writer. The copy is in memory; the
 * repository's files are only read. What is held: every task is listed old →
 * new, each file changes in the keys the migration owns and nowhere else, and
 * undoing gives every file back byte for byte.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createVaultPath, splitFrontmatter } from '@atlas/domain';
import {
  fakeIndexPort,
  fakeVaultFs,
  memoryVault,
  previewTaskMigration,
  runTaskMigration,
  undoTaskMigration,
  type MigrationPanes,
  type TaskMigrationPorts,
} from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const VAULT = new URL('../../../../vault/', import.meta.url);
const COPIED = ['tasks', '.atlas/types', '.atlas/views', '.atlas/templates'];
const LAST_CHANGED = '2026-09-29';

function repositoryVault(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const folder of COPIED) {
    for (const name of readdirSync(new URL(`${folder}/`, VAULT))) {
      if (name.endsWith('.md'))
        files[`${folder}/${name}`] = readFileSync(new URL(`${folder}/${name}`, VAULT), 'utf8');
    }
  }
  return files;
}

function vaultCopy() {
  const original = repositoryVault();
  const memory = memoryVault(original);
  const fs = fakeVaultFs({
    ...memory.fs,
    listNotes: async () =>
      [...memory.files.keys()].map((path) => ({
        name: path.split('/').at(-1) ?? path,
        path: createVaultPath(path),
        modified: 1,
        size: 1,
      })),
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
  const typeOf = (text: string) =>
    remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['type'];
  const index = fakeIndexPort({
    notesOfType: async (type) =>
      [...memory.files]
        .filter(([path, text]) => path.startsWith('tasks/') && typeOf(text) === type)
        .map(([path]) => ({ path, title: path })),
  });
  const ports: TaskMigrationPorts = {
    fs,
    markdown: remarkMarkdown,
    index,
    dayOf: () => LAST_CHANGED,
  };
  return { ports, files: memory.files, original };
}

/** A card whose frontmatter the YAML reader can read as a task — a few say `title: a: b`, which it cannot. */
const readsAsTask = (text: string) =>
  remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['type'] === 'task';

const cardsOf = (files: Record<string, string>) =>
  Object.entries(files).filter(([path]) => path.startsWith('tasks/'));

const panes: MigrationPanes = { state: () => 'closed', reload: () => {} };
const clock = { localNow: () => '2026-10-08T09:30:00' };

describe('migrating this repository’s own tasks to GTD', () => {
  it('lists every task card, old → new', async () => {
    const { ports, original } = vaultCopy();
    const cards = cardsOf(original)
      .filter(([, text]) => readsAsTask(text))
      .map(([path]) => path);
    const preview = await previewTaskMigration(ports);
    const listed = preview.tasks.filter((task) => task.path.startsWith('tasks/'));
    expect(cards.length).toBeGreaterThan(50);
    expect(listed.map((task) => task.path).sort()).toEqual(cards.sort());
    for (const task of listed)
      expect(task).toMatchObject({ from: 'done', to: 'archive', completed: LAST_CHANGED });
  });

  it('changes each card in status and completed alone, every other byte as it was', async () => {
    const { ports, files, original } = vaultCopy();
    const report = await runTaskMigration({
      ports,
      panes,
      clock,
      preview: await previewTaskMigration(ports),
    });
    expect(report.left).toEqual([]);
    for (const [path, before] of cardsOf(original)) {
      const after = files.get(path) ?? '';
      if (!readsAsTask(before)) {
        // Not a task to the index either: left exactly as it is.
        expect(after, path).toBe(before);
        continue;
      }
      expect(after).toContain('\nstatus: archive\n');
      expect(after).toContain(`\ncompleted: ${LAST_CHANGED}\n`);
      const putBack = after
        .replace('\nstatus: archive\n', '\nstatus: done\n')
        .replace(`\ncompleted: ${LAST_CHANGED}\n`, '\n');
      expect(putBack, path).toBe(before);
    }
  });

  it('moves the views that filter out finished work, the Task type and the Task template', async () => {
    const { ports, files, original } = vaultCopy();
    await runTaskMigration({ ports, panes, clock, preview: await previewTaskMigration(ports) });
    const roadmap = files.get('.atlas/views/Roadmap.md') ?? '';
    expect(roadmap).toContain('value: archive');
    expect(splitFrontmatter(roadmap).body).toBe(
      splitFrontmatter(original['.atlas/views/Roadmap.md']!).body,
    );
    expect(files.get('.atlas/views/Today.md')).toContain('value: archive');
    const type = remarkMarkdown.frontmatterProperties(
      splitFrontmatter(files.get('.atlas/types/task.md') ?? '').frontmatter,
    );
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
      blocked_by: { kind: 'text', many: true },
      waiting_on: { kind: 'relation', target: 'person' },
    });
    expect(files.get('.atlas/types/task.md')).toContain('\n# Task\n\nThe type this project');
    expect(files.has('.atlas/views/Next actions.md')).toBe(true);
    // The vault's own Inbox view is its own: it is not written over.
    expect(files.get('.atlas/views/Inbox.md')).toBe(original['.atlas/views/Inbox.md']);
  });

  it('gives every file back byte for byte when undone', async () => {
    const { ports, files, original } = vaultCopy();
    await runTaskMigration({ ports, panes, clock, preview: await previewTaskMigration(ports) });
    const undone = await undoTaskMigration({ fs: ports.fs, panes });
    expect(undone?.left).toEqual([]);
    expect(Object.fromEntries(files)).toEqual(original);
  });
});
