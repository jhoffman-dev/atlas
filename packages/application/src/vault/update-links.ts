import {
  imagePathsToCheck,
  noteTitle,
  notesAfterMoves,
  parentVaultPath,
  retargetLinks,
  type EntryMove,
  type NotesAcrossMove,
  type VaultPath,
} from '@atlas/domain';
import type { OpenEditorsPort, VaultFsPort } from './ports.ts';

/** The links a move left pointing at where a note was, by the note holding them. */
export interface LinkUpdate {
  readonly across: NotesAcrossMove;
  /** The files, after the move, that the notes' image sources could name. */
  readonly existing: ReadonlySet<VaultPath>;
  readonly notes: readonly { readonly path: VaultPath; readonly count: number }[];
  readonly total: number;
}

/** What rewriting the links did: the notes rewritten, and the ones that could not be, with why. */
export interface LinkUpdateReport {
  readonly updated: readonly VaultPath[];
  readonly failed: readonly LinkUpdateFailure[];
}

/** A note left unwritten, and why; `unsavedInApp` when a pane still held typing in it. */
export interface LinkUpdateFailure {
  readonly path: VaultPath;
  readonly reason: string;
  readonly unsavedInApp?: true;
}

/** A note left alone because a pane holds typing in it that is not saved. */
export class UnsavedTypingError extends Error {
  constructor(path: VaultPath) {
    super(`${noteTitle(path)} has unsaved changes.`);
    this.name = 'UnsavedTypingError';
  }
}

/** The panes, as rewriting a note they may hold needs them. */
export type LinkUpdatePanes = Pick<OpenEditorsPort, 'state' | 'flush'> & {
  /** Re-reads the note in every pane that holds it and has no unsaved edits. */
  reload(path: VaultPath): void;
};

/**
 * Every link, in any note, that opened a note the move carried and would no
 * longer open it, and every relative image source the move left pointing at
 * nothing — counted, so the person can be asked before anything is
 * rewritten. `notePaths` are the vault's notes from before the move; the
 * notes are read where they are now — once, however many `moves` a batch made.
 */
export async function linksToUpdate({
  fs,
  notePaths,
  ...made
}: {
  fs: VaultFsPort;
  notePaths: readonly VaultPath[];
} & ({ move: EntryMove } | { moves: readonly EntryMove[] })): Promise<LinkUpdate> {
  const across = notesAfterMoves('moves' in made ? made.moves : [made.move], notePaths);
  const files = await fs.readNotes(across.after);
  const existing = await filesAmong({
    fs,
    paths: files.flatMap((file) =>
      imagePathsToCheck({ ...across, text: file.text, path: file.path as VaultPath }),
    ),
  });
  const notes = files
    .map((file) => ({
      path: file.path as VaultPath,
      count: retargetLinks({
        ...across,
        text: file.text,
        path: file.path as VaultPath,
        exists: (path) => existing.has(path),
      }).count,
    }))
    .filter((note) => note.count > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
  return { across, existing, notes, total: notes.reduce((sum, note) => sum + note.count, 0) };
}

/** Which of `paths` are files in the vault, by listing each folder they are in once. */
async function filesAmong({
  fs,
  paths,
}: {
  fs: VaultFsPort;
  paths: readonly VaultPath[];
}): Promise<ReadonlySet<VaultPath>> {
  const wanted = new Set(paths);
  const folders = new Set([...wanted].map(parentVaultPath));
  const found = new Set<VaultPath>();
  for (const folder of folders) {
    let entries: Awaited<ReturnType<VaultFsPort['listDirectory']>> = [];
    try {
      entries = await fs.listDirectory(folder);
    } catch {
      // A folder that cannot be listed — most often one that is not there —
      // shows no files, so an image source into it is left as it is.
    }
    for (const entry of entries) {
      if (entry.kind === 'file' && wanted.has(entry.path)) found.add(entry.path);
    }
  }
  return found;
}

/**
 * Rewrites the links `linksToUpdate` found, one note at a time. A pane's
 * unsaved typing is written first so the rewrite starts from it; a note still
 * being typed in is left alone rather than raced. Each note is worked out
 * again from what it holds at the moment of writing, and written against that
 * version. One note failing does not stop the others.
 */
export async function updateLinks({
  fs,
  openNotes,
  update,
}: {
  fs: VaultFsPort;
  openNotes: LinkUpdatePanes;
  update: LinkUpdate;
}): Promise<LinkUpdateReport> {
  const updated: VaultPath[] = [];
  const failed: LinkUpdateFailure[] = [];
  for (const { path } of update.notes) {
    try {
      if (await rewrite({ fs, openNotes, path, update })) updated.push(path);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      failed.push(
        cause instanceof UnsavedTypingError
          ? { path, reason, unsavedInApp: true }
          : { path, reason },
      );
    }
  }
  return { updated, failed };
}

async function rewrite({
  fs,
  openNotes,
  path,
  update,
}: {
  fs: VaultFsPort;
  openNotes: LinkUpdatePanes;
  path: VaultPath;
  update: LinkUpdate;
}): Promise<boolean> {
  if (openNotes.state(path) === 'dirty') await openNotes.flush([path]);
  if (openNotes.state(path) === 'dirty') throw new UnsavedTypingError(path);
  const { text, modified } = await fs.readTextFile(path);
  const { text: contents, count } = retargetLinks({
    ...update.across,
    text,
    path,
    exists: (file) => update.existing.has(file),
  });
  if (count === 0) return false;
  await fs.writeTextFile({ path, contents, expectedModified: modified });
  if (openNotes.state(path) === 'clean') openNotes.reload(path);
  return true;
}
