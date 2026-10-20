import { createVaultPath, type VaultPath } from '@atlas/domain';
import { describe, expect, it, vi } from 'vitest';
import { setNoteProperties, type PropertyChanges } from '../query/set-property.ts';
import { cardMoveChanges } from '../query/card-move.ts';
import { cellEditChanges } from '../query/cell-edit.ts';
import { archiveTaskChange } from '../review/review-actions.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { ChangedSinceError } from '../today/today-actions.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { undoLastWrite, writeUndoably } from './undo-last-write.ts';

/** #320: any write a view makes, taken back to the byte — and only while the file is as it left it. */
const PATH = createVaultPath('Tasks/Send the Larkspur invoice.md');
const TODAY = '2026-10-20';
// Written by hand, not by Atlas: a comment, a quoted value, odd spacing and CRLF in the body.
const TEXT =
  '---\nstatus:   "Next"   # Mara Quill asked\ndue: 2026-10-21\nassignee: Tobias Fenn\n---\r\nCall first.\r\n';

function vaultWith(text: string) {
  const memory = memoryVault({ [PATH]: text });
  let stamp = 1;
  const writes: { expectedModified: number | null; expectedText?: string }[] = [];
  const fs = fakeVaultFs({
    ...memory.fs,
    readTextFile: async (path) => ({ ...(await memory.fs.readTextFile(path)), modified: stamp }),
    writeTextFile: async (written) => {
      writes.push({
        expectedModified: written.expectedModified,
        ...(written.expectedText !== undefined && { expectedText: written.expectedText }),
      });
      if (written.expectedModified !== null && written.expectedModified !== stamp) {
        throw new Error('the file changed underneath');
      }
      stamp += 1;
      await memory.fs.writeTextFile({ ...written, expectedModified: null });
      return stamp;
    },
  });
  const panes = { state: vi.fn(() => 'closed' as const), reload: vi.fn() };
  const contents = () => memory.files.get(PATH) ?? '';
  /** Writes the note as a view does, answering with what takes it back. */
  const write = async (values: PropertyChanges) => {
    const { record } = await writeUndoably({
      fs,
      path: PATH,
      write: (recording) =>
        setNoteProperties({
          fs: recording,
          markdown: fakeMarkdown(),
          path: PATH,
          values,
          today: TODAY,
        }),
    });
    if (record === null) throw new Error('nothing was recorded');
    return record;
  };
  /** Another program, or another pane, changing the file after the write. */
  const editElsewhere = (next: string) => {
    memory.files.set(PATH, next);
    stamp += 1;
  };
  return { fs, panes, contents, write, editElsewhere, writes };
}

describe('undoLastWrite', () => {
  it('takes a cell edit back to the exact bytes it replaced', async () => {
    const vault = vaultWith(TEXT);
    const values = cellEditChanges({
      edit: { column: 'assignee', value: 'Mara Quill', began: { value: 'Tobias Fenn' } },
      now: { assignee: 'Tobias Fenn' },
      status: null,
    });
    const record = await vault.write(values);
    expect(vault.contents()).not.toBe(TEXT);

    await undoLastWrite({ fs: vault.fs, panes: vault.panes, record });

    expect(vault.contents()).toBe(TEXT);
  });

  it('takes a tick back to the exact bytes, its status and whatever the task rules added', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write(archiveTaskChange());
    expect(vault.contents()).toContain('status: archive');

    await undoLastWrite({ fs: vault.fs, panes: vault.panes, record });

    expect(vault.contents()).toBe(TEXT);
  });

  it('takes a card dragged to another column back to the exact bytes', async () => {
    const vault = vaultWith(TEXT);
    const values = cardMoveChanges({
      column: { key: 'status', value: 'Waiting', kind: 'text' },
      lane: null,
      status: null,
      columnOptions: ['Next', 'Waiting'],
    });
    const record = await vault.write(values);
    expect(vault.contents()).toContain('Waiting');

    await undoLastWrite({ fs: vault.fs, panes: vault.panes, record });

    expect(vault.contents()).toBe(TEXT);
  });

  it('writes only over the file it read, guarded by its stamp and its whole text', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write({ status: 'Waiting' });

    await undoLastWrite({ fs: vault.fs, panes: vault.panes, record });

    expect(vault.writes.at(-1)).toEqual({ expectedModified: 2, expectedText: record.after });
  });

  it('is refused, and writes nothing, once the file has moved on since', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write({ status: 'Waiting' });
    const later = record.after.replace('Waiting', 'Done');
    vault.editElsewhere(later);

    const undo = undoLastWrite({ fs: vault.fs, panes: vault.panes, record });

    await expect(undo).rejects.toThrow(ChangedSinceError);
    await expect(undo).rejects.toThrow('“Send the Larkspur invoice” has changed since');
    expect(vault.contents()).toBe(later);
  });

  it('is refused when only the body was edited since, so typing is never lost', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write({ status: 'Waiting' });
    vault.editElsewhere(`${record.after}A line typed since.\n`);

    await expect(undoLastWrite({ fs: vault.fs, panes: vault.panes, record })).rejects.toThrow(
      'its text was edited',
    );
  });

  it('is refused, as changed since, once the note was moved or deleted (#455)', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write({ status: 'Waiting' });
    const gone = {
      ...vault.fs,
      readTextFile: async () => Promise.reject(new Error('No such file')),
    };

    const undo = undoLastWrite({ fs: gone, panes: vault.panes, record });

    await expect(undo).rejects.toThrow(ChangedSinceError);
    await expect(undo).rejects.toThrow(
      '“Send the Larkspur invoice” could not be read — it was moved or deleted since — so the change was not undone.',
    );
  });

  it('is refused while a pane holds unsaved typing in the note', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write({ status: 'Waiting' });
    vault.panes.state.mockReturnValue('dirty' as never);

    await expect(undoLastWrite({ fs: vault.fs, panes: vault.panes, record })).rejects.toThrow(
      UnsavedTypingError,
    );
    expect(vault.contents()).toBe(record.after);
  });

  it('reads the note again in a pane that has opened it since without typing', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write({ status: 'Waiting' });
    vault.panes.state.mockReturnValue('clean' as never);

    await undoLastWrite({ fs: vault.fs, panes: vault.panes, record });

    expect(vault.panes.reload).toHaveBeenCalledWith(PATH);
  });

  it('does nothing a second time: the file already says what it said before', async () => {
    const vault = vaultWith(TEXT);
    const record = await vault.write({ status: 'Waiting' });
    await undoLastWrite({ fs: vault.fs, panes: vault.panes, record });
    const writes = vault.writes.length;

    await undoLastWrite({ fs: vault.fs, panes: vault.panes, record });

    expect(vault.writes).toHaveLength(writes);
    expect(vault.contents()).toBe(TEXT);
  });
});

describe('writeUndoably', () => {
  it('records nothing when the write never reached the file — a pane took it', async () => {
    const vault = vaultWith(TEXT);
    const { result, record } = await writeUndoably({
      fs: vault.fs,
      path: PATH,
      write: async () => 'through the pane',
    });
    expect(result).toBe('through the pane');
    expect(record).toBeNull();
  });

  it('records nothing for a write that changed nothing', async () => {
    const vault = vaultWith(TEXT);
    const { record } = await writeUndoably({
      fs: vault.fs,
      path: PATH,
      write: (recording) =>
        setNoteProperties({
          fs: recording,
          markdown: fakeMarkdown(),
          path: PATH,
          values: {},
          today: TODAY,
        }),
    });
    expect(record).toBeNull();
  });

  it('records only the note it was asked about, from its first read to its last write', async () => {
    const vault = vaultWith(TEXT);
    const other: VaultPath = createVaultPath('Projects/Larkspur Payroll.md');
    const { record } = await writeUndoably({
      fs: vault.fs,
      path: PATH,
      write: async (recording) => {
        await recording.writeTextFile({ path: other, contents: 'x', expectedModified: null });
        const first = await recording.readTextFile(PATH);
        await recording.writeTextFile({
          path: PATH,
          contents: 'one',
          expectedModified: first.modified,
        });
        await recording.readTextFile(PATH);
        await recording.writeTextFile({ path: PATH, contents: 'two', expectedModified: null });
      },
    });
    expect(record).toEqual({ path: PATH, before: TEXT, after: 'two' });
  });

  it('fails as the write does, and records nothing', async () => {
    const vault = vaultWith(TEXT);
    const failing = writeUndoably({
      fs: vault.fs,
      path: PATH,
      write: async () => {
        throw new Error('disk full');
      },
    });
    await expect(failing).rejects.toThrow('disk full');
  });
});
