import {
  MIGRATION_RECORD_PATH,
  parentVaultPath,
  parseMigrationRecord,
  type MigrationRecord,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

/** The record as it is on disk, with when it was read; null when there is none. */
export async function readMigrationRecord(
  fs: VaultFsPort,
): Promise<{ record: MigrationRecord; modified: number } | null> {
  if (!(await recordExists(fs))) return null;
  const { text, modified } = await fs.readTextFile(MIGRATION_RECORD_PATH);
  return { record: parseMigrationRecord(text), modified };
}

async function recordExists(fs: VaultFsPort): Promise<boolean> {
  try {
    const entries = await fs.listDirectory(parentVaultPath(MIGRATION_RECORD_PATH));
    return entries.some((entry) => entry.path === MIGRATION_RECORD_PATH);
  } catch {
    // No migrations folder: nothing has been migrated in this vault.
    return false;
  }
}
