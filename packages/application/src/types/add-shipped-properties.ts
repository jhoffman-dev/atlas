import {
  NO_SHIPPED_PROPERTIES_RECORD,
  parentVaultPath,
  parseShippedPropertiesRecord,
  recordSettling,
  SHIPPED_PROPERTIES_RECORD_PATH,
  shippedPropertiesPlan,
  shippedPropertiesRecordText,
  type ShippedPropertiesChange,
  type ShippedPropertiesRecord,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { saveObjectType } from './edit-types.ts';
import { loadObjectTypes, type DefinedType } from './load-types.ts';

/** A built-in type file that gained properties Atlas ships, for Activity to say so. */
export interface ShippedPropertiesGained {
  readonly path: VaultPath;
  readonly label: string;
  /** The labels of the properties it gained, in the order they were added. */
  readonly added: readonly string[];
}

/** Something the properties could not be added to, and why. */
export interface ShippedPropertiesFailure {
  /** The type's label; `any type` when the record could not be read, `its record` when not written. */
  readonly name: string;
  readonly reason: string;
}

export interface ShippedPropertiesAdded {
  readonly gained: readonly ShippedPropertiesGained[];
  readonly failed: readonly ShippedPropertiesFailure[];
}

interface TypePorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
}

/**
 * Gives each built-in type file the vault has the properties Atlas ships on it
 * and the file predates (#162), and records them as settled in
 * `.atlas/migrations/type-properties.md` so it is done once.
 *
 * Each file is changed by the type editor's byte-preserving write: only the
 * properties added are written, after the file's own, and its body and every
 * key it had stay as they were. A type whose file could not be written is not
 * settled, so it is tried again the next time the vault opens. A record that
 * cannot be read stops it before anything is written.
 */
export async function addShippedProperties(ports: TypePorts): Promise<ShippedPropertiesAdded> {
  let found: Awaited<ReturnType<typeof readRecord>>;
  try {
    found = await readRecord(ports.fs);
  } catch (cause) {
    return { gained: [], failed: [{ name: 'any type', reason: reasonOf(cause) }] };
  }
  const record = found?.record ?? NO_SHIPPED_PROPERTIES_RECORD;
  const changes = shippedPropertiesPlan(await loadObjectTypes(ports), record);
  if (changes.length === 0) return { gained: [], failed: [] };

  const { written, failed } = await writeChanges(ports, changes);
  if (written.length > 0) {
    try {
      await writeRecord(ports.fs, recordSettling(record, written), found?.modified ?? null);
    } catch (cause) {
      failed.push({ name: 'its record', reason: reasonOf(cause) });
    }
  }
  const gained = written.map(({ before, added }) => ({
    path: before.path,
    label: before.label,
    added: added.map((property) => property.label),
  }));
  return { gained, failed };
}

/** Writes each type's change, carrying on past one that fails. */
async function writeChanges(
  { fs, markdown }: TypePorts,
  changes: readonly ShippedPropertiesChange<DefinedType>[],
) {
  const written: ShippedPropertiesChange<DefinedType>[] = [];
  const failed: ShippedPropertiesFailure[] = [];
  for (const change of changes) {
    const { before, after } = change;
    try {
      await saveObjectType({ fs, markdown, path: before.path, before, type: after });
      written.push(change);
    } catch (cause) {
      failed.push({ name: before.label, reason: reasonOf(cause) });
    }
  }
  return { written, failed };
}

/** The record as it is on disk, with when it was read; null when there is none. */
async function readRecord(
  fs: VaultFsPort,
): Promise<{ record: ShippedPropertiesRecord; modified: number } | null> {
  if (!(await recordExists(fs))) return null;
  const { text, modified } = await fs.readTextFile(SHIPPED_PROPERTIES_RECORD_PATH);
  return { record: parseShippedPropertiesRecord(text), modified };
}

async function recordExists(fs: VaultFsPort): Promise<boolean> {
  try {
    const entries = await fs.listDirectory(parentVaultPath(SHIPPED_PROPERTIES_RECORD_PATH));
    return entries.some((entry) => entry.path === SHIPPED_PROPERTIES_RECORD_PATH);
  } catch {
    // No migrations folder: nothing has been migrated in this vault.
    return false;
  }
}

/** Writes the record over the one read — refused if it changed since — or makes it. */
async function writeRecord(
  fs: VaultFsPort,
  record: ShippedPropertiesRecord,
  modified: number | null,
): Promise<void> {
  const contents = shippedPropertiesRecordText(record);
  if (modified !== null) {
    await fs.writeTextFile({
      path: SHIPPED_PROPERTIES_RECORD_PATH,
      contents,
      expectedModified: modified,
    });
    return;
  }
  await ensureFolder({ fs, folder: parentVaultPath(SHIPPED_PROPERTIES_RECORD_PATH) });
  await fs.createNote({ path: SHIPPED_PROPERTIES_RECORD_PATH, contents });
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
