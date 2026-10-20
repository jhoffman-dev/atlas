import { noteTitle, writeUndo, type VaultPath, type WriteRecord } from '@atlas/domain';
import { ChangedSinceError } from '../today/today-actions.ts';
import { UnsavedTypingError, type LinkUpdatePanes } from '../vault/update-links.ts';
import type { OpenEditorsPort, VaultFsPort } from '../vault/ports.ts';

/** The panes, so a note with unsaved typing is never written under, and one shown is read again once it is. */
export type UndoPanes = Pick<OpenEditorsPort, 'state'> & Pick<LinkUpdatePanes, 'reload'>;

/** What a write made through {@link writeUndoably} answered, and the record that takes it back. */
export interface UndoableWrite<Result> {
  readonly result: Result;
  /** Null when the write never reached the note's file — a pane wrote it — or changed nothing. */
  readonly record: WriteRecord | null;
}

/**
 * Makes a write to one note and records it so it can be taken back (#320):
 * the note's text as the write first read it and as it last wrote it. The
 * record is taken from the write's own read and write, through the file
 * system it is handed, so making a write undoable costs the host nothing
 * more — no read before, none after.
 */
export async function writeUndoably<Result>({
  fs,
  path,
  write,
}: {
  fs: VaultFsPort;
  path: VaultPath;
  /** The write itself, made through the file system it is handed. */
  write: (recording: VaultFsPort) => Promise<Result>;
}): Promise<UndoableWrite<Result>> {
  let before: string | null = null;
  let after: string | null = null;
  // Built on the port rather than copied from it: an adapter's methods may live on its prototype.
  const recording: VaultFsPort = Object.assign(Object.create(fs) as VaultFsPort, {
    readTextFile: async (target: VaultPath) => {
      const read = await fs.readTextFile(target);
      if (target === path && before === null) before = read.text;
      return read;
    },
    writeTextFile: async (written: Parameters<VaultFsPort['writeTextFile']>[0]) => {
      const modified = await fs.writeTextFile(written);
      if (written.path === path) after = written.contents;
      return modified;
    },
  });
  const result = await write(recording);
  const record =
    before === null || after === null || before === after ? null : { path, before, after };
  return { result, record };
}

/**
 * Takes one recorded write back (#320): a real write of the bytes the note
 * held before, never a blind overwrite. Refused with
 * {@link ChangedSinceError} — nothing written — once the note says anything
 * other than what the write left, a property or a word of the body; with
 * {@link UnsavedTypingError} while a pane holds unsaved typing in it. The
 * write itself is guarded by the stamp and the whole text just read, so a
 * change landing in between is refused by the host too. A pane showing the
 * note without typing reads it again.
 */
export async function undoLastWrite({
  fs,
  panes,
  record,
}: {
  fs: Pick<VaultFsPort, 'readTextFile' | 'writeTextFile'>;
  panes: UndoPanes;
  record: WriteRecord;
}): Promise<void> {
  const { path } = record;
  if (panes.state(path) === 'dirty') throw new UnsavedTypingError(path);
  const now = await fs.readTextFile(path);
  const undo = writeUndo({ record, now: now.text });
  if (undo.kind === 'already') return;
  if (undo.kind === 'changed') throw new ChangedSinceError(changedSince(path, undo.part));
  await fs.writeTextFile({
    path,
    contents: undo.contents,
    expectedModified: now.modified,
    expectedText: now.text,
  });
  if (panes.state(path) === 'clean') panes.reload(path);
}

function changedSince(path: VaultPath, part: 'frontmatter' | 'body'): string {
  const where = part === 'body' ? 'its text was edited' : 'its properties changed';
  return `“${noteTitle(path)}” has changed since — ${where} — so the change was not undone.`;
}
