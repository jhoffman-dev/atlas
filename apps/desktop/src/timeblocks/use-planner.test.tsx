// @vitest-environment jsdom
/**
 * P31-02: a calendar of blocks plans the day — a task let go on empty time
 * becomes a block sized to what it still needs, one let go on a block joins
 * it, byte for byte, and the last drop can be undone. Written through the real
 * markdown adapter, so what lands in the files is what the app writes.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { remarkMarkdown } from '@atlas/adapters';
import {
  fakeIndexPort,
  fakeVaultFs,
  type DefinedType,
  type PropertyChanges,
} from '@atlas/application';
import {
  BLOCK_TYPE_FILE,
  createVaultPath,
  TASK_TYPE_FILE,
  type TaskSchedule,
  type TrayTask,
  type VaultPath,
} from '@atlas/domain';
import type { PlanDrop } from '@atlas/ui';
import type { OpenEditors } from '../panes/open-editors.ts';
import { usePlanner } from './use-planner.ts';

const TYPES: readonly DefinedType[] = [
  { ...TASK_TYPE_FILE.type, path: createVaultPath('.atlas/types/task.md') },
  { ...BLOCK_TYPE_FILE.type, path: createVaultPath('.atlas/types/block.md') },
];

const ADMIN = [
  '---',
  'type: block',
  '# Kept as written.',
  'start: 2026-10-12T13:00',
  'end:   2026-10-12T14:00',
  'tasks:',
  '  - "[[Call Mara]]"',
  'colour: teal',
  '---',
  '',
  'An hour of admin.',
  '',
].join('\n');

const NOTE_PATHS = ['Quarterly report.md', 'Call Mara.md', 'Admin.md'];

const schedule = (estimate: number | null, scheduled: number): TaskSchedule => ({
  estimate,
  scheduled,
  done: estimate === null ? null : 0,
  overBy: 0,
});
const REPORT: TrayTask = {
  path: 'Quarterly report.md',
  title: 'Quarterly report',
  schedule: schedule(120, 45),
};

/** A vault of text files, written as the host writes them: never over a file that moved on. */
function memoryVault(files: Record<string, string>) {
  const stored = new Map(Object.entries(files).map(([path, text]) => [path, { text, at: 1 }]));
  const trashed: string[] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const note = stored.get(path);
      if (note === undefined) throw new Error(`no such note: ${path}`);
      return { text: note.text, modified: note.at };
    },
    createNote: async ({ path, contents }) => {
      if (stored.has(path)) throw new Error(`already there: ${path}`);
      stored.set(path, { text: contents, at: 1 });
    },
    writeTextFile: async ({ path, contents, expectedModified }) => {
      const note = stored.get(path);
      if (note === undefined || note.at !== expectedModified) throw new Error('moved on');
      stored.set(path, { text: contents, at: note.at + 1 });
      return note.at + 1;
    },
    trashEntry: async ({ path }) => {
      stored.delete(path);
      trashed.push(path);
    },
  });
  return { fs, text: (path: string) => stored.get(path)?.text, trashed };
}

/** No pane holds any note, unless `held` says it does — and then the pane writes it. */
function editorsHolding(held: (path: VaultPath, values: PropertyChanges) => boolean = () => false) {
  const setPropertiesIfOpen = vi.fn(async ({ path, values }) => held(path, values));
  const editors: OpenEditors = {
    register: () => {},
    setPropertiesIfOpen,
    savePane: () => {},
    reloadOthers: () => {},
  };
  return { editors, setPropertiesIfOpen };
}

const trayIndex = () =>
  fakeIndexPort({
    query: async (sql: string) =>
      sql.includes('AS "block"')
        ? { columns: [], rows: [], truncated: false }
        : sql.includes('AS "estimate"')
          ? {
              columns: ['path', 'estimate', 'finished'],
              rows: [['Quarterly report.md', 120, 0]],
              truncated: false,
            }
          : {
              columns: ['path', 'title'],
              rows: [['Quarterly report.md', 'Quarterly report']],
              truncated: false,
            },
  });

function planWith({
  vault,
  editors = editorsHolding().editors,
  onChanged = vi.fn(),
  active = true,
}: {
  vault: ReturnType<typeof memoryVault>;
  editors?: OpenEditors;
  onChanged?: () => void;
  active?: boolean;
}) {
  // Made once: the hook reads the tray again whenever its index or its notes change.
  const index = trayIndex();
  return renderHook(
    ({ on, key }: { on: boolean; key: string | null }) =>
      usePlanner({
        active: on,
        vault: key,
        fs: vault.fs,
        markdown: remarkMarkdown,
        index,
        editors,
        types: TYPES,
        notePaths: NOTE_PATHS,
        indexKey: 'one',
        onChanged,
      }),
    { initialProps: { on: active, key: '/Vaults/Larkspur' } },
  );
}

const drop = async (hook: ReturnType<typeof planWith>, planned: PlanDrop) => {
  await act(async () => hook.result.current?.place(planned));
};

describe('the tray', () => {
  it('reads the next actions with their schedules while the calendar is one of blocks', async () => {
    const hook = planWith({ vault: memoryVault({}) });

    await waitFor(() =>
      expect(hook.result.current?.tasks).toEqual([
        {
          path: 'Quarterly report.md',
          title: 'Quarterly report',
          schedule: { estimate: 120, scheduled: 0, done: 0, overBy: 0 },
        },
      ]),
    );
  });

  it('is nothing on any other view', () => {
    const hook = planWith({ vault: memoryVault({}), active: false });
    expect(hook.result.current).toBeNull();
  });
});

describe('a task let go on empty time', () => {
  it('becomes a block from the quarter hour, as long as what the task still needs, linked to it', async () => {
    const vault = memoryVault({});
    const onChanged = vi.fn();
    const hook = planWith({ vault, onChanged });

    await drop(hook, { kind: 'time', task: REPORT, date: '2026-10-12', minutes: 9 * 60 + 15 });

    // 2h estimated, 45m already scheduled: 1h 15m from 09:15.
    expect(vault.text('Quarterly report block.md')).toBe(
      [
        '---',
        'type: block',
        'start: 2026-10-12T09:15',
        'end: 2026-10-12T10:30',
        'tasks:',
        '  - "[[Quarterly report]]"',
        '---',
        '',
      ].join('\n'),
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(hook.result.current?.undo?.said).toBe(
      'Planned Quarterly report in Quarterly report block.',
    );
  });

  it('runs past midnight into the next day', async () => {
    const vault = memoryVault({});
    const hook = planWith({ vault });

    await drop(hook, { kind: 'time', task: REPORT, date: '2026-10-12', minutes: 23 * 60 + 30 });

    expect(vault.text('Quarterly report block.md')).toContain(
      'start: 2026-10-12T23:30\nend: 2026-10-13T00:45\n',
    );
  });

  it('is undone into the Trash, while the block is as the drop made it', async () => {
    const vault = memoryVault({});
    const onChanged = vi.fn();
    const hook = planWith({ vault, onChanged });
    await drop(hook, { kind: 'time', task: REPORT, date: '2026-10-12', minutes: 540 });

    await act(async () => hook.result.current?.undo?.run());

    expect(vault.trashed).toEqual(['Quarterly report block.md']);
    expect(hook.result.current?.undo).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});

describe('a task let go on a block', () => {
  it('joins its tasks, the rest of the file kept byte for byte, and is undone the same way', async () => {
    const vault = memoryVault({ 'Admin.md': ADMIN });
    const hook = planWith({ vault });

    await drop(hook, { kind: 'block', task: REPORT, block: 'Admin.md' });

    expect(vault.text('Admin.md')).toBe(
      ADMIN.replace('  - "[[Call Mara]]"\n', '  - "[[Call Mara]]"\n  - "[[Quarterly report]]"\n'),
    );
    expect(hook.result.current?.undo?.said).toBe('Added Quarterly report to Admin.');

    await act(async () => hook.result.current?.undo?.run());

    expect(vault.text('Admin.md')).toBe(ADMIN);
  });

  it('is written by the pane that holds the block, rather than under it', async () => {
    const vault = memoryVault({ 'Admin.md': ADMIN });
    const { editors, setPropertiesIfOpen } = editorsHolding((path) => path === 'Admin.md');
    const hook = planWith({ vault, editors });

    await drop(hook, { kind: 'block', task: REPORT, block: 'Admin.md' });

    expect(setPropertiesIfOpen).toHaveBeenCalledOnce();
    expect(vault.text('Admin.md')).toBe(ADMIN);
  });

  it('changes nothing, and keeps the last drop to undo, when the block already holds the task', async () => {
    const vault = memoryVault({ 'Admin.md': ADMIN });
    const hook = planWith({ vault });
    await drop(hook, { kind: 'block', task: REPORT, block: 'Admin.md' });
    const once = vault.text('Admin.md');

    await drop(hook, { kind: 'block', task: REPORT, block: 'Admin.md' });

    expect(vault.text('Admin.md')).toBe(once);
    expect(hook.result.current?.undo?.said).toBe('Added Quarterly report to Admin.');
  });

  it('says why a write failed, and offers no undo for it', async () => {
    const vault = memoryVault({});
    const hook = planWith({ vault });

    await drop(hook, { kind: 'block', task: REPORT, block: 'Gone.md' });

    expect(hook.result.current?.problem).toBe('no such note: Gone.md');
    expect(hook.result.current?.undo).toBeNull();
  });
});

describe('the undo', () => {
  it('is not offered in another vault than the one the drop was made in', async () => {
    const vault = memoryVault({ 'Admin.md': ADMIN });
    const hook = planWith({ vault });
    await drop(hook, { kind: 'block', task: REPORT, block: 'Admin.md' });
    expect(hook.result.current?.undo).not.toBeNull();

    hook.rerender({ on: true, key: '/Vaults/Other' });

    expect(hook.result.current?.undo).toBeNull();
  });

  it('leaves a block edited since the drop, and says so', async () => {
    const vault = memoryVault({});
    const hook = planWith({ vault });
    await drop(hook, { kind: 'time', task: REPORT, date: '2026-10-12', minutes: 540 });
    await vault.fs.writeTextFile({
      path: createVaultPath('Quarterly report block.md'),
      contents: 'edited since',
      expectedModified: 1,
    });

    await act(async () => hook.result.current?.undo?.run());

    expect(vault.trashed).toEqual([]);
    expect(hook.result.current?.problem).toBe(
      'Quarterly report block.md has changed since the task was scheduled, so it is left as it is.',
    );
  });
});

/** `memoryVault`, listing the notes made in it as the host lists the vault's notes. */
function listedVault() {
  const vault = memoryVault({});
  const made: VaultPath[] = [];
  const fs = {
    ...vault.fs,
    createNote: async (note: { path: VaultPath; contents: string }) => {
      await vault.fs.createNote(note);
      made.push(note.path);
    },
    listNotes: async () =>
      [...NOTE_PATHS.map(createVaultPath), ...made].map((path) => ({
        name: path,
        path,
        modified: 1,
        size: 1,
      })),
  };
  return { ...vault, fs };
}

describe('adversarial (P31-02)', () => {
  it('sizes a second drop of the same task, made before the tray reads again, to what the first left', async () => {
    const vault = listedVault();
    const hook = planWith({ vault });

    // 2h estimated, 45m scheduled: the first block takes the 1h 15m left, so
    // the second is for nothing more — the half hour a fully planned task gets.
    await act(async () => {
      hook.result.current?.place({ kind: 'time', task: REPORT, date: '2026-10-12', minutes: 540 });
      hook.result.current?.place({ kind: 'time', task: REPORT, date: '2026-10-13', minutes: 540 });
    });

    await waitFor(() => expect(vault.text('Quarterly report block 2.md')).toBeDefined());
    expect(vault.text('Quarterly report block.md')).toContain('end: 2026-10-12T10:15\n');
    expect(vault.text('Quarterly report block 2.md')).toContain('end: 2026-10-13T09:30\n');
  });

  it('says nothing went wrong when Undo is pressed twice before the first has finished', async () => {
    const vault = memoryVault({});
    const hook = planWith({ vault });
    await drop(hook, { kind: 'time', task: REPORT, date: '2026-10-12', minutes: 540 });
    const undo = hook.result.current?.undo;

    await act(async () => {
      undo?.run();
      undo?.run();
    });

    await waitFor(() => expect(vault.trashed).toEqual(['Quarterly report block.md']));
    expect(hook.result.current?.undo).toBeNull();
    expect(hook.result.current?.problem).toBeNull();
  });
});
