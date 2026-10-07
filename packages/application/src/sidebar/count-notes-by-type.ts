import { isArchivedPath, isAtlasNote, type ObjectType } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/**
 * How many notes each type has, for the count beside it in the sidebar.
 *
 * Asked of the index rather than counted in the vault: the index already knows
 * which notes declare which type, and walking the files to count them would
 * read every note in the vault to draw one number.
 *
 * A type the index cannot answer for counts zero rather than failing the rest —
 * a definition can be newer than the last refresh.
 */
export async function countNotesByType({
  index,
  types,
}: {
  index: IndexPort;
  types: readonly ObjectType[];
}): Promise<ReadonlyMap<string, number>> {
  const counted = await Promise.all(
    types.map(async (type) => {
      try {
        const notes = await index.notesOfType(type.name);
        // A template declares its type so notes can be made from it; it is not
        // one. An archived note was one, and is out of the way now (U-22).
        const counted = notes.filter(
          (note) => !isAtlasNote(note.path) && !isArchivedPath(note.path),
        );
        return [type.name, counted.length] as const;
      } catch {
        return [type.name, 0] as const;
      }
    }),
  );

  return new Map(counted);
}
