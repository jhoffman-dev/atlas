import {
  createVaultPath,
  LITERATURE_NOTE_TYPE,
  readLiteratureNote,
  splitFrontmatter,
  type VaultPath,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/*
 * The literature note of a PDF opened from Pages or search (#504): the note
 * whose `file:` names it. The index knows which notes are literature notes;
 * their files are read to see which one names this PDF, since what a note
 * says is the file's, not the index's (ADR-0005).
 */

export interface FindLiteratureNotePorts {
  readonly index: Pick<IndexPort, 'notesOfType'>;
  readonly fs: Pick<VaultFsPort, 'readNotes'>;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
}

/**
 * The literature note whose `file:` is `pdf`, or null when none is. Of two
 * that name it, the first by path, so the same one opens every time.
 */
export async function findLiteratureNote(
  { index, fs, markdown }: FindLiteratureNotePorts,
  pdf: VaultPath,
): Promise<VaultPath | null> {
  const listed = await index.notesOfType(LITERATURE_NOTE_TYPE);
  const files = await fs.readNotes(listed.map((note) => note.path));
  const naming = files
    .filter((file) => {
      const frontmatter = markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
      return readLiteratureNote(frontmatter)?.file === pdf;
    })
    .map((file) => file.path)
    .sort();
  const first = naming[0];
  return first === undefined ? null : createVaultPath(first);
}
