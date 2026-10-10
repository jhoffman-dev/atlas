/**
 * P31-02: a task dropped on the calendar — on empty time, a block made for it;
 * on a block, linked into it — and the drop undone.
 */
import { describe, expect, it } from 'vitest';
import {
  BLOCK_TYPE_FILE,
  createVaultPath,
  GTD_STATUS_PROPERTY,
  type ObjectType,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { PropertyChanges } from '../query/set-property.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import {
  addTaskToBlock,
  BlockChangedError,
  BlockTimesError,
  createBlockForTask,
  undoScheduling,
  type Scheduling,
} from './schedule-task.ts';

const TODAY = '2026-10-10';
const REPORT = createVaultPath('Quarterly report.md');
const CALL = createVaultPath('Call Mara.md');
const ADMIN = createVaultPath('Admin.md');
const NOTES = [REPORT, CALL, ADMIN];
const TYPES: readonly ObjectType[] = [
  { name: 'task', label: 'Task', properties: [GTD_STATUS_PROPERTY] },
  BLOCK_TYPE_FILE.type,
];

/** `fakeMarkdown`, with a list written as JSON so a test can read back the links it holds. */
function listMarkdown(): MarkdownPort {
  const base = fakeMarkdown();
  return {
    ...base,
    updateFrontmatter: (frontmatter, changes) =>
      base.updateFrontmatter(
        frontmatter,
        Object.fromEntries(
          Object.entries(changes).map(([key, value]) => [
            key,
            Array.isArray(value) ? JSON.stringify(value) : value,
          ]),
        ),
      ),
  };
}

const templateEntry = (name: string): VaultEntry => ({
  kind: 'file',
  name: `${name}.md`,
  path: createVaultPath(`.atlas/templates/${name}.md`),
});

/** A vault of text files: notes are made where asked, never over one that is there. */
function memoryVault(files: Record<string, string> = {}) {
  const stored = new Map(Object.entries(files));
  const trashed: string[] = [];
  const fs = fakeVaultFs({
    listDirectory: async (folder) =>
      folder === '.atlas/templates'
        ? [...stored.keys()]
            .filter((path) => path.startsWith('.atlas/templates/'))
            .map((path) => templateEntry(path.slice('.atlas/templates/'.length, -'.md'.length)))
        : [],
    readTextFile: async (path) => {
      const text = stored.get(path);
      if (text === undefined) throw new Error(`no such note: ${path}`);
      return { text, modified: 1 };
    },
    createNote: async ({ path, contents }) => {
      if (stored.has(path)) throw new Error(`already there: ${path}`);
      stored.set(path, contents);
    },
    trashEntry: async ({ path }) => {
      stored.delete(path);
      trashed.push(path);
    },
  });
  return { fs, stored, trashed };
}

/** Writes through the property chokepoint the app gives, evaluated against what the block holds. */
function recordingWrites(blocks: Record<string, Record<string, unknown>>) {
  const written: { path: VaultPath; values: Readonly<Record<string, unknown>> }[] = [];
  const writeProperties = async ({
    path,
    values,
  }: {
    path: VaultPath;
    values: PropertyChanges;
  }) => {
    const current = blocks[path] ?? {};
    const changes = typeof values === 'function' ? values(current) : values;
    written.push({ path, values: changes });
    blocks[path] = { ...current, ...changes };
  };
  return { writeProperties, written, blocks };
}

describe('a task dropped on empty time', () => {
  it('makes a block note linked to it, from the start for the length asked, at the top of the vault', async () => {
    const vault = memoryVault();

    const done = await createBlockForTask({
      fs: vault.fs,
      markdown: listMarkdown(),
      types: TYPES,
      task: { path: REPORT, title: 'Quarterly report' },
      start: '2026-10-12T09:00',
      minutes: 120,
      notePaths: NOTES,
      today: TODAY,
    });

    expect(done.block).toBe('Quarterly report block.md');
    expect(vault.stored.get('Quarterly report block.md')).toBe(
      [
        '---',
        'type: block',
        'start: 2026-10-12T09:00',
        'end: 2026-10-12T11:00',
        'tasks: ["[[Quarterly report]]"]',
        '---',
        '',
      ].join('\n'),
    );
    expect(done).toEqual({
      kind: 'created',
      block: 'Quarterly report block.md',
      task: REPORT,
      contents: vault.stored.get('Quarterly report block.md'),
    });
  });

  it('starts from the Block type’s template, with its times and task written over it', async () => {
    const vault = memoryVault({
      '.atlas/templates/Block.md': '---\ncolour: teal\nstart: 1999-01-01T00:00\n---\n## Agenda\n',
    });

    const done = await createBlockForTask({
      fs: vault.fs,
      markdown: listMarkdown(),
      types: TYPES,
      task: { path: CALL, title: 'Call Mara' },
      start: '2026-10-12T23:30',
      minutes: 60,
      notePaths: NOTES,
      today: TODAY,
    });

    expect(vault.stored.get(done.block)).toBe(
      [
        '---',
        'colour: teal',
        'start: 2026-10-12T23:30',
        'type: block',
        'end: 2026-10-13T00:30',
        'tasks: ["[[Call Mara]]"]',
        '---',
        '## Agenda',
        '',
      ].join('\n'),
    );
  });

  it('is numbered when a block for the task is there already: splitting a task makes another', async () => {
    const vault = memoryVault({ 'Quarterly report block.md': 'the first block' });
    const notePaths = [...NOTES, createVaultPath('Quarterly report block.md')];

    const done = await createBlockForTask({
      fs: vault.fs,
      markdown: listMarkdown(),
      types: TYPES,
      task: { path: REPORT, title: 'Quarterly report' },
      start: '2026-10-13T14:00',
      minutes: 30,
      notePaths,
      today: TODAY,
    });

    expect(done.block).toBe('Quarterly report block 2.md');
    expect(vault.stored.get('Quarterly report block.md')).toBe('the first block');
  });

  // Adversarial (P31-02): a task's own name may use nearly all of a file name's
  // 255 bytes; " block" after it must not push the block's name past them.
  it('is made for a task whose name fills nearly all of a file name, its own name fitting the disk', async () => {
    const title = `Quarterly report ${'é'.repeat(115)}`;
    const task = createVaultPath(`${title}.md`);
    const bytes = (path: string) => new TextEncoder().encode(path.split('/').at(-1) ?? path).length;
    expect(bytes(task)).toBeLessThanOrEqual(255);
    const vault = memoryVault();
    const disk = {
      ...vault.fs,
      // As APFS answers a name over 255 bytes.
      createNote: async (note: { path: VaultPath; contents: string }) => {
        if (bytes(note.path) > 255) throw new Error('File name too long (os error 63)');
        return vault.fs.createNote(note);
      },
    };

    const done = await createBlockForTask({
      fs: disk,
      markdown: listMarkdown(),
      types: TYPES,
      task: { path: task, title },
      start: '2026-10-12T09:00',
      minutes: 30,
      notePaths: [...NOTES, task],
      today: TODAY,
    });

    expect(bytes(done.block)).toBeLessThanOrEqual(255);
    expect(vault.stored.has(done.block)).toBe(true);
  });

  it('is refused before anything is made when the times make no block', async () => {
    const vault = memoryVault();
    const make = (start: string, minutes: number) =>
      createBlockForTask({
        fs: vault.fs,
        markdown: listMarkdown(),
        types: TYPES,
        task: { path: REPORT, title: 'Quarterly report' },
        start,
        minutes,
        notePaths: NOTES,
        today: TODAY,
      });

    await expect(make('2026-10-12', 60)).rejects.toBeInstanceOf(BlockTimesError);
    await expect(make('2026-10-12T09:00', 0)).rejects.toBeInstanceOf(BlockTimesError);
    expect(vault.stored.size).toBe(0);
  });
});

describe('a task dropped on a block', () => {
  it('is linked after the block’s tasks, through the property write the app gives', async () => {
    const writes = recordingWrites({ [ADMIN]: { tasks: ['[[Call Mara]]'] } });

    const done = await addTaskToBlock({
      writeProperties: writes.writeProperties,
      block: ADMIN,
      task: REPORT,
      notePaths: NOTES,
    });

    expect(done).toEqual({ kind: 'added', block: ADMIN, task: REPORT });
    expect(writes.blocks[ADMIN]).toEqual({
      tasks: ['[[Call Mara]]', '[[Quarterly report]]'],
    });
  });

  it('writes nothing, and leaves nothing to undo, when the block already holds the task', async () => {
    const writes = recordingWrites({ [ADMIN]: { tasks: ['[[Quarterly report]]'] } });

    const done = await addTaskToBlock({
      writeProperties: writes.writeProperties,
      block: ADMIN,
      task: REPORT,
      notePaths: NOTES,
    });

    expect(done).toBeNull();
    expect(writes.written).toEqual([{ path: ADMIN, values: {} }]);
  });
});

describe('undoing a drop', () => {
  it('puts a block the drop made in the Trash while it holds what the drop wrote', async () => {
    const vault = memoryVault();
    const markdown = listMarkdown();
    const done = await createBlockForTask({
      fs: vault.fs,
      markdown,
      types: TYPES,
      task: { path: REPORT, title: 'Quarterly report' },
      start: '2026-10-12T09:00',
      minutes: 60,
      notePaths: NOTES,
      today: TODAY,
    });

    await undoScheduling({
      scheduling: done,
      fs: vault.fs,
      index: fakeIndexPort(),
      writeProperties: recordingWrites({}).writeProperties,
      notePaths: [...NOTES, done.block],
    });

    expect(vault.trashed).toEqual(['Quarterly report block.md']);
    expect(vault.stored.has(done.block)).toBe(false);
  });

  it('leaves a block edited since the drop, and says so', async () => {
    const block = createVaultPath('Quarterly report block.md');
    const vault = memoryVault({ [block]: 'edited since' });
    const scheduling: Scheduling = { kind: 'created', block, task: REPORT, contents: 'as made' };

    await expect(
      undoScheduling({
        scheduling,
        fs: vault.fs,
        index: fakeIndexPort(),
        writeProperties: recordingWrites({}).writeProperties,
        notePaths: [...NOTES, block],
      }),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(vault.trashed).toEqual([]);
    expect(vault.stored.get(block)).toBe('edited since');
  });

  it('unlinks a task the drop added, keeping the block’s other tasks as written', async () => {
    const writes = recordingWrites({
      [ADMIN]: { tasks: ['[[Call Mara|the call]]', '[[Quarterly report]]'] },
    });

    await undoScheduling({
      scheduling: { kind: 'added', block: ADMIN, task: REPORT },
      fs: memoryVault().fs,
      index: fakeIndexPort(),
      writeProperties: writes.writeProperties,
      notePaths: NOTES,
    });

    expect(writes.blocks[ADMIN]).toEqual({ tasks: ['[[Call Mara|the call]]'] });
  });

  it('writes nothing to a block that no longer links the task', async () => {
    const writes = recordingWrites({ [ADMIN]: { tasks: ['[[Call Mara]]'] } });

    await undoScheduling({
      scheduling: { kind: 'added', block: ADMIN, task: REPORT },
      fs: memoryVault().fs,
      index: fakeIndexPort(),
      writeProperties: writes.writeProperties,
      notePaths: NOTES,
    });

    expect(writes.written).toEqual([{ path: ADMIN, values: {} }]);
    expect(writes.blocks[ADMIN]).toEqual({ tasks: ['[[Call Mara]]'] });
  });
});
