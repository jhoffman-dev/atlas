import {
  createVaultPath,
  holdsTypeValues,
  migrationChanges,
  splitFrontmatter,
  valuesThatWontFit,
  type NoteMigration,
  type PropertyDef,
  type VaultPath,
} from '@atlas/domain';
import type { OpenNotes } from '../api/ports.ts';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { setNoteProperties } from '../query/set-property.ts';
import type { VaultFsPort } from '../vault/ports.ts';

interface NotesOfType {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  typeName: string;
}

/**
 * The notes of a type, read from their files — the index says which notes they
 * are, and the files say what they hold now. Views, dashboards and sources that
 * name the type are left out: the type's keys mean nothing in them.
 */
async function readNotesOfType({ fs, markdown, index, typeName }: NotesOfType) {
  const listed = await index.notesOfType(typeName);
  if (listed.length === 0) return [];
  const files = await fs.readNotes(listed.map((note) => note.path));
  return files
    .map((file) => ({
      path: createVaultPath(file.path),
      properties: markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter),
    }))
    .filter((note) => holdsTypeValues(note.properties));
}

/** The notes of a type that a migration would change — the count to confirm with. */
export async function notesToMigrate(
  args: NotesOfType & { migration: NoteMigration },
): Promise<VaultPath[]> {
  const notes = await readNotesOfType(args);
  return notes
    .filter((note) => migrationChanges(args.migration, note.properties) !== null)
    .map((note) => note.path);
}

/**
 * How many notes of a type hold a value the property, as changed, will not
 * accept — the warning before a kind change turns text into a number.
 */
export async function countValuesThatWontFit(
  args: NotesOfType & { def: PropertyDef },
): Promise<number> {
  const notes = await readNotesOfType(args);
  const values = notes
    .filter((note) => Object.prototype.hasOwnProperty.call(note.properties, args.def.key))
    .map((note) => note.properties[args.def.key]);
  return valuesThatWontFit({ def: args.def, values });
}

/** What a migration did: the notes it rewrote, and the ones it could not, with why. */
export interface MigrationReport {
  readonly migrated: readonly VaultPath[];
  readonly failed: readonly { readonly path: VaultPath; readonly reason: string }[];
}

/**
 * Brings each note along with a change to its type.
 *
 * Every note goes through the same write as any property edit: through the
 * pane holding it when one does, else the byte-preserving file write. The
 * change is worked out again from what the note holds at the moment of
 * writing, so a note edited since it was counted is not clobbered. One note
 * failing does not stop the others; each failure is reported.
 */
export async function migrateNotes({
  fs,
  markdown,
  openNotes,
  paths,
  migration,
  today,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: Pick<OpenNotes, 'setPropertiesIfOpen'>;
  paths: readonly VaultPath[];
  migration: NoteMigration;
  /** `YYYY-MM-DD`: a task the migration finishes is dated by it, as any write's is (ADR-0029). */
  today: string;
}): Promise<MigrationReport> {
  const migrated: VaultPath[] = [];
  const failed: { path: VaultPath; reason: string }[] = [];

  // One at a time: a batch across a whole vault should not open every file at once.
  for (const path of paths) {
    // Whether the note, as it is at the moment of writing, still held what changed.
    let changed = false;
    const values = (properties: Readonly<Record<string, unknown>>) => {
      const changes = migrationChanges(migration, properties);
      changed = changes !== null;
      return changes ?? {};
    };
    try {
      const takenByAPane = await openNotes.setPropertiesIfOpen({ path, values });
      if (!takenByAPane) await setNoteProperties({ fs, markdown, path, values, today });
      if (changed) migrated.push(path);
    } catch (cause) {
      failed.push({ path, reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { migrated, failed };
}
