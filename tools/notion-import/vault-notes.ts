import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  createVaultPath,
  isConflictCopyPath,
  splitFrontmatter,
  type VaultPath,
} from '../../packages/domain/src/index.ts';
import { notionIdOf } from './notion-relations.ts';
import { markdownFiles, readFrontmatter } from './vault-meetings.ts';

/** The vault's notes as the import plans against them. */
export interface VaultNotes {
  /** Every note, vault-relative: what a new note's name must not take, and what links are resolved among. */
  readonly paths: readonly VaultPath[];
  /** The notes each Notion page id is in, by their `notion_id`. */
  readonly byNotionId: ReadonlyMap<string, readonly VaultPath[]>;
}

/** The Notion page a note says it came from, or null. */
function notionIdOfNote(text: string): string | null {
  if (!text.includes('notion_id')) return null;
  const frontmatter = splitFrontmatter(text).frontmatter;
  if (frontmatter === null) return null;
  return notionIdOf(readFrontmatter(frontmatter).properties['notion_id']);
}

/**
 * Every note in the vault, hidden files and folders left out as everywhere
 * in Atlas (ADR-0014), and the ones a Notion page is in, found by the
 * `notion_id` they carry wherever they were moved, renamed or archived —
 * the earlier, one-off import's notes too. A sync conflict's copy is no
 * note of its own.
 */
export async function vaultNotes(vault: string): Promise<VaultNotes> {
  const paths: VaultPath[] = [];
  const byNotionId = new Map<string, VaultPath[]>();
  for (const file of await markdownFiles(vault)) {
    const path = createVaultPath(relative(vault, file).split(sep).join('/'));
    paths.push(path);
    if (isConflictCopyPath(path)) continue;
    const id = notionIdOfNote(await readFile(join(vault, path), 'utf8'));
    if (id === null) continue;
    byNotionId.set(id, [...(byNotionId.get(id) ?? []), path]);
  }
  return { paths, byNotionId };
}
