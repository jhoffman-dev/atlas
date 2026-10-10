import { createVaultPath, isTemplateNote, type NoteNames } from '@atlas/domain';
import { notesInUseOfTypes } from '../archive/notes-in-use.ts';
import type { IndexPort } from '../index/ports.ts';

/**
 * Every note a relation can point at, as the link a card in its group would
 * hold — so a board grouped by project has a column (or a lane) for each
 * project, even one with nothing in it yet. A relation to several types has
 * one for each note of every one of them, a type at a time (P30-01).
 */
export async function relationGroupLinks({
  index,
  targets,
  names,
}: {
  index: Pick<IndexPort, 'notesOfType'>;
  /** The types the relation points at (`relationTypes`). */
  targets: readonly string[];
  /** Links a note the way it is found, not by the title it may give itself. */
  names: NoteNames;
}): Promise<string[]> {
  const notes = await notesInUseOfTypes({ index, types: targets });
  // A template says `type: project` without being a project.
  return notes
    .filter((note) => !isTemplateNote(note.path))
    .map((note) => names.linkTo(createVaultPath(note.path)));
}
