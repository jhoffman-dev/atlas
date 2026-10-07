import {
  NEW_NOTE_CONTENTS,
  newNoteFolder,
  nextAvailableNotePath,
  type VaultPath,
} from '@atlas/domain';
import { listVaultNotes } from '../vault/read-vault.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { guardTemplateEdit } from '../vault/template-guard.ts';

/**
 * How many names are tried when each one is taken between listing and
 * creating. Each round of notes made at the same moment gives at least one
 * of them its name, so this is how many can be made at once — five "+ New"
 * from an agent, say — before one is refused. Bounded, since each try lists
 * the vault again.
 */
export const CREATE_ATTEMPTS = 20;

/** No free name was found: every one tried was taken before the note could be made. */
export class NoteNameTakenError extends Error {
  constructor(name: string, options: { cause: unknown }) {
    super(
      `No free name for ${JSON.stringify(name)}: ${CREATE_ATTEMPTS} were taken while it was being made`,
      options,
    );
    this.name = 'NoteNameTakenError';
  }
}

/**
 * Creates a note and reports where it landed.
 *
 * It goes into `folder` when one is named — "New note here" on a folder.
 * Otherwise `newNoteFolder` says: a dashboard or a view with its kind,
 * anything else beside the note in view, or at the root. A name
 * already in use is numbered rather than refused, so the button always works —
 * including when another program takes the name after `notePaths` was listed:
 * the host refuses, the vault is listed again and the next number is tried.
 */
export async function createNote({
  fs,
  name,
  beside,
  folder: named,
  notePaths,
  contents,
  properties = {},
}: {
  fs: VaultFsPort;
  name: string;
  /** The note currently open, whose folder the new one joins. */
  beside: VaultPath | null;
  /** The folder to put it in, which wins over `beside`. */
  folder?: VaultPath;
  notePaths: readonly VaultPath[];
  /** Starting text, when the note comes from a template. */
  contents?: string;
  /** The frontmatter `contents` starts with, read as values. */
  properties?: Readonly<Record<string, unknown>>;
}): Promise<VaultPath> {
  const folder = named ?? newNoteFolder({ beside, properties });
  let taken: readonly VaultPath[] = notePaths;

  for (let attempt = 1; ; attempt += 1) {
    const path = nextAvailableNotePath({ folder, name, taken: new Set<string>(taken) });
    guardTemplateEdit([path]);
    try {
      await fs.createNote({ path, contents: contents ?? NEW_NOTE_CONTENTS });
      return path;
    } catch (error) {
      taken = await listVaultNotes({ fs });
      // Refused for some reason other than the name being taken: trying again is pointless.
      if (nextAvailableNotePath({ folder, name, taken: new Set<string>(taken) }) === path) {
        throw error;
      }
      if (attempt === CREATE_ATTEMPTS) throw new NoteNameTakenError(name, { cause: error });
    }
  }
}
