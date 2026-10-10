import { isArchivedPath, isAtlasNote } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/**
 * The notes of a type that are still in use — what a relation, a board's
 * links or a project picker offers. An archived note is out of the way, so it
 * is not suggested (U-22); a link to one that already exists still opens it.
 * A note in `.atlas` is never offered: the type's template declares the type
 * without being one of its notes, and picking it linked the template (issue #15).
 */
export async function notesInUseOfType({
  index,
  type,
}: {
  index: Pick<IndexPort, 'notesOfType'>;
  type: string;
}): Promise<readonly { path: string; title: string }[]> {
  return (await index.notesOfType(type)).filter(
    (note) => !isArchivedPath(note.path) && !isAtlasNote(note.path),
  );
}

/** A note a relation can point at, and which of its types it is. */
export interface NoteOfType {
  readonly path: string;
  readonly title: string;
  readonly type: string;
}

/**
 * The notes still in use of each of `types`, a type at a time in the order
 * given — what a relation that points at several types offers. A note listed
 * under two of them is offered once, under the first.
 */
export async function notesInUseOfTypes({
  index,
  types,
}: {
  index: Pick<IndexPort, 'notesOfType'>;
  types: readonly string[];
}): Promise<readonly NoteOfType[]> {
  const listed = await Promise.all(
    types.map(async (type) =>
      (await notesInUseOfType({ index, type })).map((note) => ({ ...note, type })),
    ),
  );
  const offered = new Map<string, NoteOfType>();
  for (const note of listed.flat()) if (!offered.has(note.path)) offered.set(note.path, note);
  return [...offered.values()];
}
