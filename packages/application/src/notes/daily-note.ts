import {
  DAILY_NOTE_CONTENTS,
  dailyNoteAmong,
  joinVaultPath,
  noteFileName,
  VAULT_ROOT,
  type VaultPath,
} from '@atlas/domain';
import { newNoteTaskRules } from '../gtd/task-rules.ts';
import { findDailyTemplate, readTemplate, type NoteTemplate } from '../types/templates.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import type { MarkdownPort } from './ports.ts';

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
 * Found where it should be if it is already there, however the disk spells
 * its name — a daily note imported from elsewhere included — otherwise created at the root, never beside
 * whatever note happens to be in view, or the next ask would not find it. It
 * starts from the vault's Daily template when it has one, and as a note of the
 * built-in Daily type otherwise.
 *
 * Its exact name is the point, so it is not made through `createNote`, which
 * numbers a taken name; what it starts as is held to the task rules here, as
 * `createNote` holds every other new note (ADR-0029).
 */
export async function ensureDailyNote({
  fs,
  markdown,
  today,
  notePaths,
  templates,
}: {
  fs: VaultFsPort;
  /** What the starting text is judged and dated through. */
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;
  /** `YYYY-MM-DD`, from the `Clock`. */
  today: string;
  notePaths: readonly VaultPath[];
  templates: readonly NoteTemplate[];
}): Promise<{ path: VaultPath; created: boolean }> {
  const existing = dailyNoteAmong(today, notePaths);
  if (existing !== null) return { path: existing, created: false };
  const path = dailyNotePath(today);

  const template = findDailyTemplate(templates);
  const started = template === null ? DAILY_NOTE_CONTENTS : await readTemplate({ fs, template });
  const contents = newNoteTaskRules({ markdown, contents: started, today });
  try {
    await fs.createNote({ path, contents });
  } catch (error) {
    // Another program made it after the listing, or the disk holds it under
    // another spelling: it is found, not numbered.
    const found = dailyNoteAmong(today, await listVaultNotes({ fs }));
    if (found !== null) return { path: found, created: false };
    throw error;
  }
  return { path, created: true };
}
