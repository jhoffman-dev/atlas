import { homeFolderOf, type VaultPath } from '@dfai/domain';
import { loadObjectTypes, noteTypeName } from '../types/load-types.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from './ports.ts';

/**
 * The home folder of a note of these properties, for its day, as the vault's
 * types say (#214): its type file's `folder:`, or the built-in default. Null
 * for a note with no type, whose types are then not read at all.
 */
export async function homeFolderFor({
  fs,
  markdown,
  properties,
  today,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
  properties: Readonly<Record<string, unknown>>;
  /** `YYYY-MM-DD`: the day of a note that names none of its own. */
  today: string;
}): Promise<VaultPath | null> {
  if (noteTypeName(properties) === null) return null;
  const types = await loadObjectTypes({ fs, markdown });
  return homeFolderOf({ properties, types, today });
}
