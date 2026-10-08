import {
  builtInTypePlan,
  createVaultPath,
  newTypeFrontmatter,
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

/** A type that could not be written or extended, and why. */
export interface TypeSetupFailure {
  readonly name: string;
  readonly reason: string;
}

/** What opening a vault did to its types, and what it leaves to be asked. */
export interface BuiltInTypesEnsured {
  /** The type files written because the vault had none. */
  readonly created: readonly VaultPath[];
  /**
   * The vault's own types PARA would add to. Changing a file the vault
   * already has is offered, never done on opening.
   */
  readonly pending: readonly PendingTypeExtension[];
  readonly failed: readonly TypeSetupFailure[];
}

interface TypePorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
}

/**
 * Writes the PARA types a vault has no file for — Project, Area, Resource —
 * and says which of its own types PARA would add to (P30-01).
 *
 * Only files that are not there are written, and the host refuses to write
 * over one that is: a type file that exists but cannot be read is reported,
 * never replaced. Nothing the vault has is changed here; see
 * {@link extendBuiltInTypes} for that, which runs only when asked.
 */
export async function ensureBuiltInTypes(ports: TypePorts): Promise<BuiltInTypesEnsured> {
  const existing = await loadObjectTypes(ports);
  const plan = builtInTypePlan(existing);
  const created: VaultPath[] = [];
  const failed: TypeSetupFailure[] = [];
  for (const { type, body } of plan.missing) {
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
  return { created, pending: plan.extensions, failed };
}

/**
 * Adds to the vault's own types what PARA needs of them — a `project` that
 * can point at a project or an area — after the person said yes to it.
 *
 * Each file is changed by the same byte-preserving write the type editor
 * uses: only the property added or widened is written, and everything else in
 * the file, the properties James added included, stays as it was.
 */
export async function extendBuiltInTypes({
  fs,
  markdown,
  extensions,
}: TypePorts & {
  extensions: readonly PendingTypeExtension[];
}): Promise<{ extended: readonly VaultPath[]; failed: readonly TypeSetupFailure[] }> {
  const extended: VaultPath[] = [];
  const failed: TypeSetupFailure[] = [];
  for (const { before, after } of extensions) {
    try {
      await saveObjectType({ fs, markdown, path: before.path, before, type: after });
      extended.push(before.path);
    } catch (cause) {
      failed.push({ name: before.label, reason: reasonOf(cause) });
    }
  }
  return { extended, failed };
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
