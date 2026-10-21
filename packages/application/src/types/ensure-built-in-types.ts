import {
  builtInTypePlan,
  combinedExtensions,
  createVaultPath,
  dailyTypeToOffer,
  extensionKeys,
  extensionWithin,
  inboxTypePlan,
  newTypeFrontmatter,
  type BuiltInTypeFile,
  type ShippedCatalogue,
  type TypeExtension,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { addShippedProperties, type ShippedPropertiesAdded } from './add-shipped-properties.ts';
import { saveObjectType } from './edit-types.ts';
import { loadObjectTypes, TYPES_FOLDER, type DefinedType } from './load-types.ts';

/** A type of the vault's own that PARA would extend; `before.path` is its file. */
export type PendingTypeExtension = TypeExtension<DefinedType>;

/** What setting the vault's types up would still do, once the person says yes. */
export interface TypeSetupOffer {
  /**
   * The types to write: PARA's, in a vault that has not taken PARA up, and
   * the Inbox's Proposal and Decision and today's note's Daily, which are
   * always asked about.
   */
  readonly types: readonly BuiltInTypeFile[];
  /**
   * The vault's own types that would gain a `project` linking a project or an
   * area, its Project type the `para` and `area` it predates (#213), and its
   * Meeting type the keys the meeting import writes.
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
  /** The built-in type files given the properties DFAI ships that they predate (#162). */
  readonly properties: ShippedPropertiesAdded;
  /**
   * What is offered rather than done: anything else that would change a file
   * the vault has — PARA's `project` on its own types, a shipped key it took off.
   */
  readonly offer: TypeSetupOffer;
}

interface TypePorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
}

/**
 * Makes a vault's built-in types whole as it opens, as far as that can be
 * done without asking, and works out what PARA (P30-01, #213) and the Inbox
 * (P29-02, P28-04) would have the vault's types hold.
 *
 * First each built-in type file the vault has gains the properties DFAI
 * ships on it and the file predates, once (#162, {@link addShippedProperties}):
 * a feature built on one, such as Accept linking a meeting's task through
 * `tasks`, would otherwise fail. A key the file has is never changed.
 *
 * PARA is one Project type (#213). A vault without one has not taken PARA
 * up, and is only offered it; so is the change PARA would make to the
 * vault's own types, its Project type's `para` and `area` among them.
 * Nothing of PARA's is written without a yes: the Area and Resource types a
 * vault with projects was once given on opening are PARA values now. The
 * Proposal, Decision and Daily types are only ever offered, and the host
 * refuses to write over a file that is there, readable or not. See
 * {@link acceptTypeSetup}.
 *
 * One run at a time per vault: a call while one is under way for the same
 * vault — React's StrictMode running an effect twice, say — is answered by
 * that run, rather than racing it to the same files and reporting the write
 * the other made as a failure. `vault` names the vault the host has open.
 */
export function ensureBuiltInTypes(
  ports: TypePorts & { readonly vault?: string; readonly shipped?: ShippedCatalogue },
): Promise<BuiltInTypesEnsured> {
  const vault = ports.vault ?? null;
  const running = underWay.get(ports.fs);
  if (running !== undefined && running.vault === vault) return running.run;
  const run = setUpTypes(ports).finally(() => {
    if (underWay.get(ports.fs)?.run === run) underWay.delete(ports.fs);
  });
  underWay.set(ports.fs, { vault, run });
  return run;
}

/** The run setting a vault's types up, by the host it goes through. */
const underWay = new WeakMap<
  VaultFsPort,
  { readonly vault: string | null; readonly run: Promise<BuiltInTypesEnsured> }
>();

async function setUpTypes(
  ports: TypePorts & { readonly shipped?: ShippedCatalogue },
): Promise<BuiltInTypesEnsured> {
  const properties = await addShippedProperties(ports);
  return { properties, offer: setupOffer(await loadObjectTypes(ports)) };
}

/** What is offered rather than done to the vault's types. */
function setupOffer(types: readonly DefinedType[]): TypeSetupOffer {
  const para = builtInTypePlan(types);
  const inbox = inboxTypePlan(types);
  return {
    types: [...(para.filesByProject ? [] : para.missing), ...inbox.missing, ...daily(types)],
    extensions: combinedExtensions(para.extensions, inbox.extensions),
  };
}

/**
 * Does what {@link ensureBuiltInTypes} offered, once the person said yes:
 * writes the PARA type offered, then gives the vault's own types what they
 * lack: a `project` that can point at a project or an area, and on the
 * Project type `para` and `area`.
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
    types: [...para.missing, ...inbox.missing, ...daily(types)].filter((file) =>
      named.has(file.type.name),
    ),
    extensions: combinedExtensions(asShown(para.extensions), asShown(inbox.extensions)),
  };
}

/** The Daily type, as a list of the files to offer: empty when the vault has it. */
function daily(types: readonly DefinedType[]): BuiltInTypeFile[] {
  const file = dailyTypeToOffer(types);
  return file === null ? [] : [file];
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

/** A built-in type's file as DFAI writes it: its definition, then a body saying what it is. */
export function builtInTypeContents(
  markdown: MarkdownPort,
  { type, body }: BuiltInTypeFile,
): string {
  return `${markdown.updateFrontmatter(null, newTypeFrontmatter(type))}\n${body}`;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
