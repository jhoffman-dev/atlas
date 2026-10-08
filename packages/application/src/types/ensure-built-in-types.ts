import {
  builtInTypePlan,
  createVaultPath,
  newTypeFrontmatter,
  type BuiltInTypeFile,
  type TypeExtension,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { saveObjectType } from './edit-types.ts';
import { loadObjectTypes, TYPES_FOLDER, type DefinedType } from './load-types.ts';

/** A type of the vault's own that PARA would extend; `before.path` is its file. */
export type PendingTypeExtension = TypeExtension<DefinedType>;

/** What setting the vault up for PARA would still do, once the person says yes. */
export interface TypeSetupOffer {
  /** The PARA types to write, in a vault that has not taken PARA up. */
  readonly types: readonly BuiltInTypeFile[];
  /** The vault's own types that would gain a `project` linking a project or an area. */
  readonly extensions: readonly PendingTypeExtension[];
}

/** A type that could not be written or extended, and why. */
export interface TypeSetupFailure {
  readonly name: string;
  readonly reason: string;
}

/** What opening a vault did to its types, and what it leaves to be asked. */
export interface BuiltInTypesEnsured {
  /** The type files written because the vault had none. */
  readonly created: readonly VaultPath[];
  /** What is offered rather than done: changing a file the vault has is never done on opening. */
  readonly offer: TypeSetupOffer;
  readonly failed: readonly TypeSetupFailure[];
}

interface TypePorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
}

/**
 * Makes a vault's types whole for PARA as it opens, as far as that can be
 * done without asking (P30-01).
 *
 * A vault that files by project — it has a Project type — has the Area and
 * Resource types it lacks written in. A vault that has not taken PARA up is
 * only offered them, and so is the change PARA would make to the vault's own
 * types: nothing the vault has is changed here, and the host refuses to write
 * over a file that is there, readable or not. See {@link acceptTypeSetup}.
 */
export async function ensureBuiltInTypes(ports: TypePorts): Promise<BuiltInTypesEnsured> {
  const plan = builtInTypePlan(await loadObjectTypes(ports));
  const offer = { types: plan.filesByProject ? [] : plan.missing, extensions: plan.extensions };
  if (!plan.filesByProject) return { created: [], offer, failed: [] };
  return { ...(await writeTypeFiles(ports, plan.missing)), offer };
}

/**
 * Does what {@link ensureBuiltInTypes} offered, once the person said yes:
 * writes the PARA types offered, then gives the vault's own types a `project`
 * that can point at a project or an area.
 *
 * Each existing file is changed by the same byte-preserving write the type
 * editor uses: only the property added or widened is written, and everything
 * else in the file, the properties James added included, stays as it was.
 */
export async function acceptTypeSetup({
  fs,
  markdown,
  offer,
}: TypePorts & {
  offer: TypeSetupOffer;
}): Promise<{
  created: readonly VaultPath[];
  extended: readonly VaultPath[];
  failed: readonly TypeSetupFailure[];
}> {
  const written = await writeTypeFiles({ fs, markdown }, offer.types);
  const extended: VaultPath[] = [];
  const failed: TypeSetupFailure[] = [...written.failed];
  for (const { before, after } of offer.extensions) {
    try {
      await saveObjectType({ fs, markdown, path: before.path, before, type: after });
      extended.push(before.path);
    } catch (cause) {
      failed.push({ name: before.label, reason: reasonOf(cause) });
    }
  }
  return { created: written.created, extended, failed };
}

/** Writes each type's file into `.atlas/types`, never over one that is there. */
async function writeTypeFiles(
  ports: TypePorts,
  files: readonly BuiltInTypeFile[],
): Promise<{ created: readonly VaultPath[]; failed: readonly TypeSetupFailure[] }> {
  const created: VaultPath[] = [];
  const failed: TypeSetupFailure[] = [];
  for (const { type, body } of files) {
    try {
      const folder = await ensureFolder({ fs: ports.fs, folder: createVaultPath(TYPES_FOLDER) });
      const path = createVaultPath(`${folder}/${type.name}.md`);
      const frontmatter = ports.markdown.updateFrontmatter(null, newTypeFrontmatter(type));
      await ports.fs.createNote({ path, contents: `${frontmatter}\n${body}` });
      created.push(path);
    } catch (cause) {
      failed.push({ name: type.label, reason: reasonOf(cause) });
    }
  }
  return { created, failed };
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
