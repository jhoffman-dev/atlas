/**
 * Bringing a type's notes along with a change to the type: a renamed key or
 * option, or a removed key. What is asserted is which notes are counted, that
 * each is written once through the right path, and that one failure neither
 * stops the rest nor goes unreported.
 */
import { describe, expect, it } from 'vitest';
import { parseObjectType, type VaultPath } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeOpenNotes, fakeVaultFs } from '../testing/fake-ports.ts';
import { countValuesThatWontFit, migrateNotes, notesToMigrate } from './migrate-notes.ts';

const note = (lines: string[]) => ['---', ...lines, '---', '', 'Body.', ''].join('\n');

const FILES: Record<string, string> = {
  'tasks/a.md': note(['type: task', 'status: review']),
  'tasks/b.md': note(['type: task', 'status: done']),
  'tasks/c.md': note(['type: task', 'status: review', 'phase: soon']),
  // A view names the type too, but its keys are settings.
  '.atlas/views/Board.md': note(['atlas: view', 'type: task', 'status: review']),
};

function vault({ failOn = null }: { failOn?: string | null } = {}) {
  const writes = new Map<string, string>();
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.map((path) => ({ path, text: FILES[path] ?? '', modified: 1, size: 1 })),
    readTextFile: async (path) => ({ text: FILES[path] ?? '', modified: 1 }),
    writeTextFile: async ({ path, contents }) => {
      if (path === failOn) throw new Error('the note changed on disk');
      writes.set(path, contents);
      return 2;
    },
  });
  const index = fakeIndexPort({
    notesOfType: async () => Object.keys(FILES).map((path) => ({ path, title: path })),
  });
  return { fs, index, writes, markdown: fakeMarkdown() };
}

const rename = { kind: 'renameOption', key: 'status', from: 'review', to: 'in review' } as const;

describe('notesToMigrate', () => {
  it('counts the notes holding what changed, and never a view', async () => {
    const { fs, index, markdown } = vault();
    const paths = await notesToMigrate({
      fs,
      markdown,
      index,
      typeName: 'task',
      migration: rename,
    });
    expect(paths).toEqual(['tasks/a.md', 'tasks/c.md']);
  });

  it('counts nothing when the type has no notes', async () => {
    const { fs, markdown } = vault();
    const index = fakeIndexPort({ notesOfType: async () => [] });
    expect(
      await notesToMigrate({ fs, markdown, index, typeName: 'task', migration: rename }),
    ).toEqual([]);
  });
});

describe('migrateNotes', () => {
  it('rewrites each note once, leaving its other keys and body', async () => {
    const { fs, writes, markdown } = vault();
    const report = await migrateNotes({
      today: '2026-10-08',
      fs,
      markdown,
      openNotes: fakeOpenNotes(),
      paths: ['tasks/a.md', 'tasks/c.md'] as VaultPath[],
      migration: rename,
    });
    expect(report).toEqual({ migrated: ['tasks/a.md', 'tasks/c.md'], failed: [] });
    expect(writes.get('tasks/a.md')).toContain('status: in review');
    expect(writes.get('tasks/c.md')).toContain('phase: soon');
    expect(writes.get('tasks/c.md')).toMatch(/Body\.\n$/);
  });

  it('writes a note held by a pane through that pane, not underneath it', async () => {
    const { fs, writes, markdown } = vault();
    const throughPane: string[] = [];
    const report = await migrateNotes({
      today: '2026-10-08',
      fs,
      markdown,
      openNotes: fakeOpenNotes({
        setPropertiesIfOpen: async ({ path, values }) => {
          if (path !== 'tasks/a.md') return false;
          const changes = typeof values === 'function' ? values({ status: 'review' }) : values;
          throughPane.push(JSON.stringify(changes));
          return true;
        },
      }),
      paths: ['tasks/a.md', 'tasks/c.md'] as VaultPath[],
      migration: rename,
    });
    expect(throughPane).toEqual(['{"status":"in review"}']);
    expect([...writes.keys()]).toEqual(['tasks/c.md']);
    expect(report.migrated).toHaveLength(2);
  });

  it('carries on past a note it cannot write, and reports it with the reason', async () => {
    const { fs, writes, markdown } = vault({ failOn: 'tasks/a.md' });
    const report = await migrateNotes({
      today: '2026-10-08',
      fs,
      markdown,
      openNotes: fakeOpenNotes(),
      paths: ['tasks/a.md', 'tasks/c.md'] as VaultPath[],
      migration: rename,
    });
    expect(report.failed).toEqual([{ path: 'tasks/a.md', reason: 'the note changed on disk' }]);
    expect(report.migrated).toEqual(['tasks/c.md']);
    expect(writes.has('tasks/c.md')).toBe(true);
  });
});

describe('countValuesThatWontFit', () => {
  it('counts the notes whose value the new kind will not take', async () => {
    const { fs, index, markdown } = vault();
    const [phase] = parseObjectType({ name: 'task', properties: { phase: 'number' } }).properties;
    if (phase === undefined) throw new Error('fixture');
    expect(
      await countValuesThatWontFit({ fs, markdown, index, typeName: 'task', def: phase }),
    ).toBe(1);
  });
});

describe('migrateNotes — adversarial', () => {
  // Counted, then edited elsewhere before the batch reached it: the change
  // works out to nothing, yet the file is still rewritten (re-stringifying its
  // whole frontmatter) and reported as migrated.
  it('writes nothing to a note that no longer holds what changed', async () => {
    const { fs, writes, markdown } = vault();
    const report = await migrateNotes({
      today: '2026-10-08',
      fs,
      markdown,
      openNotes: fakeOpenNotes(),
      paths: ['tasks/b.md'] as VaultPath[],
      migration: rename,
    });
    expect([...writes.keys()]).toEqual([]);
    expect(report.migrated).toEqual([]);
  });
});
