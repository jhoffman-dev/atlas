import {
  joinVaultPath,
  NEW_NOTE_CONTENTS,
  noteFileName,
  VAULT_ROOT,
  type VaultPath,
} from '@atlas/domain';
import { findDailyTemplate, readTemplate, type NoteTemplate } from '../types/templates.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';

/**
 * Where today's note lives: named by the date, at the root of the vault, which
 * is what every other tool that keeps daily notes settles on.
 */
export function dailyNotePath(today: string): VaultPath {
  return joinVaultPath(VAULT_ROOT, noteFileName(today));
}

/**
 * Today's note, made on demand.
 *
 * Found where it should be if it is already there; otherwise created at the
 * root — never beside whatever note happens to be in view, or the next ask
 * would not find it — from the vault's Daily template when it has one.
 */
export async function ensureDailyNote({
  fs,
  today,
  notePaths,
  templates,
}: {
  fs: VaultFsPort;
  /** `YYYY-MM-DD`, from the `Clock`. */
  today: string;
  notePaths: readonly VaultPath[];
  templates: readonly NoteTemplate[];
}): Promise<{ path: VaultPath; created: boolean }> {
  const path = dailyNotePath(today);
  if (notePaths.includes(path)) return { path, created: false };

  const template = findDailyTemplate(templates);
  const contents = template === null ? undefined : await readTemplate({ fs, template });
  try {
    await fs.createNote({ path, contents: contents ?? NEW_NOTE_CONTENTS });
  } catch (error) {
    // Another program made it after the listing: it is found, not numbered.
    if ((await listVaultNotes({ fs })).includes(path)) return { path, created: false };
    throw error;
  }
  return { path, created: true };
}
