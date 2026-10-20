// @vitest-environment jsdom
/**
 * #300: a cell committed in a view's table writes its note once, typed as
 * its editor committed it, and is drawn as committed before the index reads
 * it back — the pending-row rules a board's drag keeps (#260). A commit from
 * a row whose cell changed since the edit began is refused, writing nothing,
 * and the refusal is said over the table. A relation's notes are read only
 * once its picker asks for them.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, type ObjectType, type PropertyDef } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs, openNote, recordingActivity } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import type { OpenEditors } from '../panes/open-editors.ts';
import { createTickMemory } from './tick-memory.ts';
import { useTableAsPending } from './use-pending-cards.ts';
import { useSavedView } from './use-saved-view.ts';
import { useViewDrafts } from './use-view-drafts.ts';

const VIEW_PATH = createVaultPath('.atlas/views/Tasks.md');
const VIEW = [
  '---',
  'atlas: view',
  'type: task',
  'columns: [status, phase, owner]',
  '---',
  '',
  '# Tasks',
  '',
].join('\n');

const property = (key: string, extra: Partial<PropertyDef> = {}): PropertyDef => ({
  key,
  kind: 'text',
  label: key,
  required: false,
  options: [],
  target: null,
  many: false,
  ...extra,
});

const TYPES: readonly ObjectType[] = [
  {
    name: 'task',
    label: 'Task',
    properties: [
      property('status', { kind: 'select', options: ['backlog', 'doing', 'done'] }),
      property('phase', { kind: 'number' }),
      property('owner', { kind: 'relation', target: 'person' }),
    ],
  },
];

const HALL = 'book the hall.md';
const FILES: Record<string, string> = {
  [HALL]: '---\ntype: task\nstatus: backlog\nphase: 2\n---\n\nFor Larkspur Payroll.\n',
};

const noPane: OpenEditors = {
  register: () => {},
  setPropertiesIfOpen: async () => false,
  savePane: () => {},
  reloadOthers: () => {},
};

const field = (text: string, key: string) =>
  new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1] ?? null;

async function table() {
  const files: Record<string, string> = { [VIEW_PATH]: VIEW, ...FILES };
  const indexedNow = () => {
    const text = files[HALL] ?? '';
    const phase = field(text, 'phase');
    return [[HALL, 'book the hall', field(text, 'status'), phase === null ? null : Number(phase)]];
  };
  let indexed = indexedNow();
  let held: Promise<void> | null = null;
  let failing: string | null = null;
  const writes: string[] = [];
  const peopleAsked: string[] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return { text, modified: 1 };
    },
    writeTextFile: async ({ path, contents }) => {
      if (held !== null) await held;
      if (failing !== null) throw new Error(failing);
      writes.push(path);
      files[path] = contents;
      return 2;
    },
  });
  const index = fakeIndexPort({
    query: async (sql: string) =>
      sql.includes('v_task')
        ? { columns: ['path', 'title', 'status', 'phase'], rows: indexed, truncated: false }
        : { columns: [], rows: [], truncated: false },
    notesOfType: async (type: string) => {
      peopleAsked.push(type);
      return [{ path: 'people/Mara Quill.md', title: 'Mara Quill' }];
    },
  });
  const note = await openNote({ fs, markdown: remarkMarkdown, path: VIEW_PATH });
  const tickMemory = createTickMemory();
  const view = renderHook(
    ({ indexKey }: { indexKey: string }) => {
      const saved = useSavedView({
        activity: recordingActivity(),
        note,
        index,
        fs,
        markdown: remarkMarkdown,
        types: TYPES,
        notePaths: [HALL],
        indexKey,
        onChanged: () => {},
        editors: noPane,
        tickMemory,
        drafts: useViewDrafts('/vault'),
        viewPaths: [VIEW_PATH],
      });
      // The table as it is drawn: the view's result with its cells' edits laid over.
      const shown = useTableAsPending({
        pending: saved.pendingBoard.pending,
        result: saved.result,
      });
      return { ...saved, shown };
    },
    { initialProps: { indexKey: 'ready:1' } },
  );
  await waitFor(() => expect(view.result.current.result?.rows).toHaveLength(1));
  const cell = (column: string) => {
    const shown = view.result.current.shown.result;
    const at = shown?.columns.indexOf(column) ?? -1;
    return shown?.rows[0]?.[at];
  };
  return {
    view,
    files,
    writes,
    peopleAsked,
    cell,
    refresh: (indexKey: string) => {
      indexed = indexedNow();
      view.rerender({ indexKey });
    },
    hold: () => {
      let open: () => void = () => {};
      held = new Promise<void>((resolve) => (open = resolve));
      return () => {
        held = null;
        open();
      };
    },
    fail: (reason: string) => {
      failing = reason;
    },
  };
}

describe('useSavedView — a cell edited in place (#300)', () => {
  it('writes a typed value once, as its editor typed it', async () => {
    const { view, files, writes } = await table();
    await act(() =>
      view.result.current.editCell({
        path: HALL,
        column: 'phase',
        value: 3,
        began: { value: 2 },
      }),
    );
    expect(writes).toEqual([HALL]);
    expect(field(files[HALL] ?? '', 'phase')).toBe('3');
    expect(files[HALL]).toContain('For Larkspur Payroll.');
  });

  it('draws the cell as committed before its write lands, and as read once the index has it', async () => {
    const { view, cell, hold, refresh } = await table();
    const release = hold();
    let landed: Promise<void> = Promise.resolve();
    act(() => {
      landed = view.result.current.editCell({
        path: HALL,
        column: 'status',
        value: 'doing',
        began: { value: 'backlog' },
      });
    });
    expect(cell('status')).toBe('doing');
    release();
    await act(() => landed);
    refresh('ready:2');
    await waitFor(() => expect(view.result.current.result?.rows[0]?.[2]).toBe('doing'));
    expect(cell('status')).toBe('doing');
  });

  it('refuses a commit from a row whose cell changed since the edit began, and says so', async () => {
    const { view, files, writes, cell } = await table();
    const before = files[HALL];
    let refused: unknown = null;
    await act(() =>
      view.result.current
        .editCell({ path: HALL, column: 'status', value: 'doing', began: { value: 'done' } })
        .catch((cause: unknown) => {
          refused = cause;
        }),
    );
    expect(refused).toBeInstanceOf(Error);
    expect(writes).toEqual([]);
    expect(files[HALL]).toBe(before);
    expect(cell('status')).toBe('backlog');
    expect(view.result.current.shown.failure).toMatch(/changed while it was being edited/);
  });

  it('puts the cell back and says why when its write fails', async () => {
    const { view, cell, fail } = await table();
    fail('The disk is full.');
    let failed = false;
    await act(() =>
      view.result.current
        .editCell({ path: HALL, column: 'status', value: 'done', began: { value: 'backlog' } })
        .catch(() => {
          failed = true;
        }),
    );
    expect(failed).toBe(true);
    expect(cell('status')).toBe('backlog');
    expect(view.result.current.shown.failure).toMatch(/The disk is full/);
  });

  it('a commit the caller does not wait on raises nothing when it fails', async () => {
    const { view, fail } = await table();
    fail('The disk is full.');
    // Ignored, as a table ignores a commit's promise: the failure is said over the table.
    act(() => {
      void view.result.current.editCell({ path: HALL, column: 'phase', value: 4 });
    });
    await waitFor(() => expect(view.result.current.shown.failure).toMatch(/disk is full/));
  });

  it('a refused commit the caller does not wait on raises nothing either', async () => {
    const { view, writes } = await table();
    act(() => {
      void view.result.current.editCell({
        path: HALL,
        column: 'status',
        value: 'doing',
        began: { value: 'done' },
      });
    });
    await waitFor(() => expect(view.result.current.shown.failure).toMatch(/being edited/));
    expect(writes).toEqual([]);
  });

  it('reads a relation’s notes only once its picker asks, then offers them', async () => {
    const { view, peopleAsked } = await table();
    expect(peopleAsked).toEqual([]);
    expect(view.result.current.relationChoices).toEqual({});
    act(() => view.result.current.wantRelationChoices('owner'));
    await waitFor(() =>
      expect(view.result.current.relationChoices.owner).toEqual([
        { path: 'people/Mara Quill.md', title: 'Mara Quill', type: 'person' },
      ]),
    );
    expect(peopleAsked).toEqual(['person']);
  });
});
