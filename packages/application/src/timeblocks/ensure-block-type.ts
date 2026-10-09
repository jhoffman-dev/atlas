import { blockTypeToWrite, type VaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { writeTypeFiles, type TypeSetupFailure } from '../types/ensure-built-in-types.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * Writes the Block type into a vault that has tasks and no Block type yet,
 * as it opens (P31-01): timeblocks are notes of it. Nothing the vault has is
 * changed, and the host refuses to write over a file that is there.
 */
export async function ensureBlockType(ports: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
}): Promise<{ created: readonly VaultPath[]; failed: readonly TypeSetupFailure[] }> {
  const file = blockTypeToWrite(await loadObjectTypes(ports));
  return writeTypeFiles(ports, file === null ? [] : [file]);
}
