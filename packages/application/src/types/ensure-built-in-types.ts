import {
  builtInTypePlan,
  combinedExtensions,
  createVaultPath,
  extensionKeys,
  extensionWithin,
  inboxTypePlan,
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

/** What setting the vault's types up would still do, once the person says yes. */
export interface TypeSetupOffer {
  /**
   * The types to write: PARA's, in a vault that has not taken PARA up, and
   * the Inbox's Proposal and Decision, which are always asked about.
   */
  readonly types: readonly BuiltInTypeFile[];
  /**
   * The vault's own types that would gain a `project` linking a project or an
   * area, and its Meeting type the keys the meeting import writes.
   */
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
 * done without asking (P30-01), and works out what else the Inbox would have
 * the vault's types hold (P29-02, P28-04).
 *
 * A vault that files by project — it has a Project type — has the Area and
 * Resource types it lacks written in. A vault that has not taken PARA up is
 * only offered them, and so is the change PARA would make to the vault's own
 * types. The Proposal and Decision types, and the meeting import's keys on
 * the vault's Meeting type, are only ever offered: nothing the vault has is
 * changed here, and the host refuses to write over a file that is there,
 * readable or not. See {@link acceptTypeSetup}.
 */
export async function ensureBuiltInTypes(ports: TypePorts): Promise<BuiltInTypesEnsured> {
  const { para, offer } = setupPlan(await loadObjectTypes(ports));
  if (!para.filesByProject) return { created: [], offer, failed: [] };
  return { ...(await writeTypeFiles(ports, para.missing)), offer };
}

/** PARA's plan for the vault's types, and what is offered rather than done. */
function setupPlan(types: readonly DefinedType[]) {
  const para = builtInTypePlan(types);
  const inbox = inboxTypePlan(types);
  const offer: TypeSetupOffer = {
    types: [...(para.filesByProject ? [] : para.missing), ...inbox.missing],
    extensions: combinedExtensions(para.extensions, inbox.extensions),
  };
  return { para, offer };
}

/**
 * Does what {@link ensureBuiltInTypes} offered, once the person said yes:
 * writes the PARA types offered, then gives the vault's own types a `project`
 * that can point at a project or an area.
 *
 * The offer says which types; what each gets is worked out again from the
 * type files as they are now, since they may have been edited while it
 * waited: a property removed in the meantime stays removed, and a type that
 * no longer lacks anything is left alone.
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
  const now = await stillOffered({ fs, markdown }, offer);
  const written = await writeTypeFiles({ fs, markdown }, now.types);
  const extended: VaultPath[] = [];
  const failed: TypeSetupFailure[] = [...written.failed];
  for (const { before, after } of now.extensions) {
    try {
      await saveObjectType({ fs, markdown, path: before.path, before, type: after });
      extended.push(before.path);
    } catch (cause) {
      failed.push({ name: before.label, reason: reasonOf(cause) });
    }
  }
  return { created: written.created, extended, failed };
}

/**
 * What of `offer` the vault's types still lack, worked out from their files as
 * they are now — and no more than it showed: each plan's change to a type is
 * kept only for the properties the offer listed for that type, so a change
 * one plan came to want while the offer waited is never written unseen.
 */
async function stillOffered(ports: TypePorts, offer: TypeSetupOffer): Promise<TypeSetupOffer> {
  const types = await loadObjectTypes(ports);
  const para = builtInTypePlan(types);
  const inbox = inboxTypePlan(types);
  const named = new Set(offer.types.map((file) => file.type.name));
  const shown = new Map(
    offer.extensions.map((extension) => [extension.before.name, extensionKeys(extension)]),
  );
  const asShown = (extensions: readonly PendingTypeExtension[]) =>
    extensions.flatMap((extension) => {
      const keys = shown.get(extension.before.name);
      const within = keys === undefined ? null : extensionWithin(extension, keys);
      return within === null ? [] : [within];
    });
  return {
    types: [...para.missing, ...inbox.missing].filter((file) => named.has(file.type.name)),
    extensions: combinedExtensions(asShown(para.extensions), asShown(inbox.extensions)),
  };
}

/** Writes each type's file into `.atlas/types`, never over one that is there. */
export async function writeTypeFiles(
  ports: TypePorts,
  files: readonly BuiltInTypeFile[],
): Promise<{ created: readonly VaultPath[]; failed: readonly TypeSetupFailure[] }> {
  const created: VaultPath[] = [];
  const failed: TypeSetupFailure[] = [];
  for (const { type, body } of files) {
    try {
      const folder = await ensureFolder({ fs: ports.fs, folder: createVaultPath(TYPES_FOLDER) });
      const path = createVaultPath(`${folder}/${type.name}.md`);
      await ports.fs.createNote({
        path,
        contents: builtInTypeContents(ports.markdown, { type, body }),
      });
      created.push(path);
    } catch (cause) {
      failed.push({ name: type.label, reason: reasonOf(cause) });
    }
  }
  return { created, failed };
}

/** A built-in type's file as Atlas writes it: its definition, then a body saying what it is. */
export function builtInTypeContents(
  markdown: MarkdownPort,
  { type, body }: BuiltInTypeFile,
): string {
  return `${markdown.updateFrontmatter(null, newTypeFrontmatter(type))}\n${body}`;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
