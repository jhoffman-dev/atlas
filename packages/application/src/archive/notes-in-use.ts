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
