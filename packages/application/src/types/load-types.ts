import {
  createVaultPath,
  parseObjectType,
  splitFrontmatter,
  TYPES_DIRECTORY,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';

/** Where a vault keeps its type definitions. */
export const TYPES_FOLDER = TYPES_DIRECTORY;

/** A type as the vault defines it: the definition, and the file it is written in. */
export interface DefinedType extends ObjectType {
  readonly path: VaultPath;
}

/**
 * Reads the type definitions out of the vault.
 *
 * Types are ordinary notes, so they can be edited in any editor and travel with
 * the vault. A definition that cannot be read is skipped rather than failing the
 * others: one malformed file should not cost you every type you have.
 */
export async function loadObjectTypes({
  fs,
  markdown,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
}): Promise<DefinedType[]> {
  const folder = createVaultPath(TYPES_FOLDER);

  let paths: VaultPath[];
  try {
    const entries = await fs.listDirectory(folder);
    paths = entries
      .filter((entry) => entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.path);
  } catch {
    // A vault with no .atlas/types folder simply has no types yet.
    return [];
  }

  if (paths.length === 0) return [];

  const files = await fs.readNotes(paths);
  const types: DefinedType[] = [];

  for (const file of files) {
    try {
      const { frontmatter } = splitFrontmatter(file.text);
      const type = parseObjectType(markdown.frontmatterProperties(frontmatter));
      types.push({ ...type, path: createVaultPath(file.path) });
    } catch {
      // Skipped: a broken definition costs that one type, nothing else.
    }
  }

  return types.sort((left, right) => left.name.localeCompare(right.name));
}

/** The type a note declares, or null when it declares none. */
export function noteTypeName(frontmatter: Readonly<Record<string, unknown>>): string | null {
  const declared = frontmatter['type'];
  const name = declared === undefined || declared === null ? '' : String(declared).trim();
  return name === '' ? null : name;
}
