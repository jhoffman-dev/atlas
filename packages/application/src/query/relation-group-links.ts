import { createVaultPath, isTemplateNote, type NoteNames } from '@atlas/domain';
import { notesInUseOfType } from '../archive/notes-in-use.ts';
import type { IndexPort } from '../index/ports.ts';

/**
 * Every note a relation can point at, as the link a card in its group would
 * hold — so a board grouped by project has a column (or a lane) for each
 * project, even one with nothing in it yet.
 */
export async function relationGroupLinks({
  index,
  target,
  names,
}: {
  index: Pick<IndexPort, 'notesOfType'>;
  /** The type the relation points at. */
  target: string;
  /** Links a note the way it is found, not by the title it may give itself. */
  names: NoteNames;
}): Promise<string[]> {
  const notes = await notesInUseOfType({ index, type: target });
  // A template says `type: project` without being a project.
  return notes
    .filter((note) => !isTemplateNote(note.path))
    .map((note) => names.linkTo(createVaultPath(note.path)));
}
