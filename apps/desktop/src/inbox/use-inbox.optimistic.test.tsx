// @vitest-environment jsdom
/**
 * #217: a clarified row leaves the Inbox at once and is written behind the
 * page, so the next row can be worked straight away. A write that fails
 * brings its row back with why, to try again; Undo still takes the last one
 * back; and the window's close waits for what is still being written.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  fakeIndexPort,
  fakeMarkdown,
  fakeVaultFs,
  memoryVault,
  recordingActivity,
  type ArchivePorts,
  type WindowClosingPort,
} from '@atlas/application';
import { createVaultPath, INBOX_QUERY_COLUMNS, TASK_TYPE_FILE } from '@atlas/domain';
import { useInbox, type InboxOptions } from './use-inbox.ts';

const CALL = createVaultPath('Inbox/Call Mara Quill.md');
const PAY = createVaultPath('Inbox/Pay Tobias Fenn.md');
const CAPTURED = '---\ntype: task\nstatus: inbox\n---\n\nAbout Larkspur Payroll.\n';

/** A promise and the function that settles it, to hold a write mid-way. */
function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

function inbox() {
  const memory = memoryVault({ [CALL]: CAPTURED, [PAY]: CAPTURED });
  // What the index lists: every note still waiting, as of the last refresh.
  let listed = [CALL, PAY];
  let held: Promise<void> | null = null;
  let failing: string | null = null;
  const written: string[] = [];
  const ports: ArchivePorts = {
    fs: fakeVaultFs({
      ...memory.fs,
      writeTextFile: async (write) => {
        if (held !== null) await held;
        if (failing !== null) throw new Error(failing);
        written.push(write.path);
        return memory.fs.writeTextFile(write);
      },
    }),
    markdown: fakeMarkdown(),
    index: fakeIndexPort({
      query: async () => ({
        columns: [...INBOX_QUERY_COLUMNS],
        rows: listed.map((at) => [at, at, 'task', 0, null, null, 'inbox']),
        truncated: false,
      }),
    }),
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  const closes: (() => Promise<void>)[] = [];
  const closing: WindowClosingPort = {
    beforeClose: async (task) => {
      closes.push(task);
      return () => {};
    },
  };
  const onSettled = vi.fn();
  const initial: InboxOptions = {
    ports,
    notePaths: [CALL, PAY],
    vaultKey: '/vaults/larkspur',
    types: [TASK_TYPE_FILE.type],
    clock: { today: () => '2026-10-14' },
    indexKey: 'ready:1',
    open: true,
    onSettled,
    activity: recordingActivity(),
    closing,
  };
  const hook = renderHook((options: InboxOptions) => useInbox(options), { initialProps: initial });
  const shown = () => hook.result.current.contents?.items.map((item) => item.path) ?? null;
  return {
    hook,
    files: memory.files,
    written,
    onSettled,
    closes,
    shown,
    /** The index catches up: it lists only these, and says so with a new key. */
    refresh: (still: readonly (typeof CALL)[], indexKey: string) => {
      listed = [...still];
      hook.rerender({ ...initial, indexKey });
    },
    hold: () => {
      const writes = gate();
      held = writes.opened;
      return () => {
        held = null;
        writes.open();
      };
    },
    fail: (reason: string | null) => {
      failing = reason;
    },
  };
}

describe('useInbox — a clarified row leaves at once (#217)', () => {
  it('takes the row off the list before its write is done, and the total with it', async () => {
    const { hook, shown, hold, files } = inbox();
    await waitFor(() => expect(shown()).toEqual([CALL, PAY]));
    const release = hold();

    let written: Promise<boolean> = Promise.resolve(false);
    act(() => {
      written = hook.result.current.clarify({
        path: CALL,
        clarification: { status: 'next-action' },
      });
    });

    expect(shown()).toEqual([PAY]);
    expect(hook.result.current.contents?.total).toBe(1);
    expect(hook.result.current.busy).toBe(false);
    expect(files.get(CALL)).toBe(CAPTURED);

    release();
    await act(async () => {
      expect(await written).toBe(true);
    });
    expect(files.get(CALL)).toContain('status: next-action');
  });

  it('takes the next row while the last is still being written, and writes both in turn', async () => {
    const { hook, shown, hold, written, onSettled } = inbox();
    await waitFor(() => expect(shown()).toEqual([CALL, PAY]));
    const release = hold();

    const outcomes: Promise<boolean>[] = [];
    act(() => {
      outcomes.push(
        hook.result.current.clarify({ path: CALL, clarification: { status: 'next-action' } }),
      );
    });
    act(() => {
      outcomes.push(
        hook.result.current.clarify({ path: PAY, clarification: { status: 'someday' } }),
      );
    });
    expect(shown()).toEqual([]);

    release();
    await act(async () => {
      expect(await Promise.all(outcomes)).toEqual([true, true]);
    });
    expect(written).toEqual([CALL, PAY]);
    // Read again once for the run of writes, not once for each.
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('keeps a written row off until the index has caught up, then shows what it says', async () => {
    const { hook, shown, refresh } = inbox();
    await waitFor(() => expect(shown()).toEqual([CALL, PAY]));
    await act(() =>
      hook.result.current.clarify({ path: CALL, clarification: { status: 'next-action' } }),
    );
    expect(shown()).toEqual([PAY]);

    // An index that has moved on, and lists the row no more.
    refresh([PAY], 'ready:2');
    await waitFor(() => expect(shown()).toEqual([PAY]));

    // Listed again by an index that has moved on since — put back by hand, say — it is shown.
    refresh([CALL, PAY], 'ready:3');
    await waitFor(() => expect(shown()).toEqual([CALL, PAY]));
  });
});

describe('useInbox — a write that fails (#217)', () => {
  it('brings the row back with why, records nothing lost, and can be tried again', async () => {
    const { hook, shown, hold, fail, files } = inbox();
    await waitFor(() => expect(shown()).toEqual([CALL, PAY]));
    const release = hold();
    fail('the disk is full');

    let outcome: Promise<boolean> = Promise.resolve(true);
    act(() => {
      outcome = hook.result.current.clarify({
        path: CALL,
        clarification: { status: 'next-action' },
      });
    });
    expect(shown()).toEqual([PAY]);

    release();
    await act(async () => {
      expect(await outcome).toBe(false);
    });
    expect(shown()).toEqual([CALL, PAY]);
    expect(hook.result.current.refusal).toEqual({ path: CALL, reason: 'the disk is full' });
    expect(files.get(CALL)).toBe(CAPTURED);

    fail(null);
    await act(async () => {
      expect(
        await hook.result.current.clarify({ path: CALL, clarification: { status: 'next-action' } }),
      ).toBe(true);
    });
    expect(shown()).toEqual([PAY]);
    expect(hook.result.current.refusal).toBeNull();
    expect(files.get(CALL)).toContain('status: next-action');
  });
});

describe('useInbox — Undo, with writes behind the page (#217)', () => {
  it('takes the last one back once its write is done, and only once however often it is pressed', async () => {
    const { hook, shown, files, onSettled } = inbox();
    await waitFor(() => expect(shown()).toEqual([CALL, PAY]));
    await act(() =>
      hook.result.current.clarify({ path: CALL, clarification: { status: 'next-action' } }),
    );
    expect(hook.result.current.lastAction).toEqual({ title: 'Call Mara Quill' });

    let outcomes: boolean[] = [];
    await act(async () => {
      outcomes = await Promise.all([hook.result.current.undo(), hook.result.current.undo()]);
    });

    expect(outcomes).toEqual([true, false]);
    expect(files.get(CALL)).toBe(CAPTURED);
    expect(hook.result.current.problem).toBeNull();
    expect(hook.result.current.lastAction).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(2);
  });
});

describe('useInbox — closing the window (#217)', () => {
  it('holds the close until what is being written is written', async () => {
    const { hook, shown, hold, closes, files } = inbox();
    await waitFor(() => expect(shown()).toEqual([CALL, PAY]));
    await waitFor(() => expect(closes).toHaveLength(1));
    const release = hold();
    act(() => {
      void hook.result.current.clarify({ path: CALL, clarification: { status: 'next-action' } });
    });

    let closed = false;
    const closing = closes[0]?.().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release();
    await act(async () => {
      await closing;
    });
    expect(closed).toBe(true);
    expect(files.get(CALL)).toContain('status: next-action');
  });
});
