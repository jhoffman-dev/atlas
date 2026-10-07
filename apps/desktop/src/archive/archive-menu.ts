import {
  archiveRefusal,
  isArchivedPath,
  notesUnder,
  type MovableEntry,
  type VaultPath,
} from '@atlas/domain';
import type { MenuCommand } from '@atlas/ui';
import type { ArchiveCommands } from './use-archive.ts';

/**
 * The notes archiving `entry` would put away: the note itself, or every note
 * under the folder — the ones that can be archived.
 */
export function archivableNotes(entry: MovableEntry, notePaths: readonly VaultPath[]): VaultPath[] {
  return notesUnder(entry, notePaths).filter((path) => archiveRefusal(path) === null);
}

/**
 * A Pages row's "Archive" (or, for an archived note, "Unarchive"), for its menu.
 *
 * A folder archives every note in it, each to its own path under `Archive/`;
 * the folder and any files that are not notes stay where they are.
 */
export function archiveCommand({
  entry,
  notePaths,
  commands,
}: {
  entry: MovableEntry;
  notePaths: readonly VaultPath[];
  commands: ArchiveCommands;
}): MenuCommand {
  if (entry.kind === 'file' && isArchivedPath(entry.path)) {
    return {
      label: 'Unarchive',
      onSelect: () => commands.unarchive([entry.path]),
      disabled: commands.busy,
    };
  }
  const notes = archivableNotes(entry, notePaths);
  return {
    label: entry.kind === 'directory' ? `Archive ${countNotes(notes.length)}` : 'Archive',
    onSelect: () => commands.archive(notes),
    disabled: commands.busy || notes.length === 0,
  };
}

const countNotes = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/** A menu with `command` added just before its destructive items, or at its end. */
export function withCommandBeforeDelete(
  items: readonly MenuCommand[],
  command: MenuCommand,
): MenuCommand[] {
  const at = items.findIndex((item) => item.destructive === true);
  if (at === -1) return [...items, command];
  return [...items.slice(0, at), command, ...items.slice(at)];
}
