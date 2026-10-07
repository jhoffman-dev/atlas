import {
  declaredTypeName,
  parentVaultPath,
  splitFrontmatter,
  TYPES_DIRECTORY,
  type MovableEntry,
} from '@atlas/domain';
import type { VaultFsPort } from './ports.ts';

/**
 * The entry with the type its file declares, when it is a type's file — so a
 * built-in type written under another file name is refused a delete or a
 * rename as surely as `person.md` is (A21-02). Anything else comes back as it
 * was, unread.
 */
export async function withDeclaredType({
  fs,
  entry,
}: {
  fs: Pick<VaultFsPort, 'readTextFile'>;
  entry: MovableEntry;
}): Promise<MovableEntry> {
  const inTypes = parentVaultPath(entry.path).toLowerCase() === TYPES_DIRECTORY;
  if (entry.kind !== 'file' || !inTypes) return entry;
  const { text } = await fs.readTextFile(entry.path);
  const { frontmatter } = splitFrontmatter(text);
  return { ...entry, definesType: frontmatter === null ? null : declaredTypeName(frontmatter) };
}
