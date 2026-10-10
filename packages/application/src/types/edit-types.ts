import {
  addProperty,
  createVaultPath,
  newObjectType,
  newTypeFrontmatter,
  setRelation,
  typeFrontmatterChanges,
  type ObjectType,
  type PropertyDef,
  type PropertyKind,
  type SidebarIcon,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { writeFrontmatterChanges } from '../query/set-property.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { TYPES_FOLDER, type DefinedType } from './load-types.ts';

/**
 * Makes a new, empty type and writes its file, `.atlas/types/<name>.md`.
 *
 * Whether the name is usable is the domain's to say; this refuses before
 * writing anything, and the host refuses to write over a file already there.
 */
export async function createObjectType({
  fs,
  markdown,
  label,
  icon = null,
  existing,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  label: string;
  icon?: SidebarIcon | null;
  existing: readonly ObjectType[];
}): Promise<DefinedType> {
  const type = newObjectType({ label, icon, existing: existing.map((known) => known.name) });
  const path = createVaultPath(`${TYPES_FOLDER}/${type.name}.md`);
  const frontmatter = markdown.updateFrontmatter(null, newTypeFrontmatter(type));
  // A heading, so the file reads as what it is when opened anywhere else.
  await fs.createNote({ path, contents: `${frontmatter}\n# ${type.label}\n` });
  return { ...type, path };
}

/**
 * Writes an edited type back to its file.
 *
 * Only what the edit changed is written — the label, the icon, the properties
 * it touched — worked out by the domain against the frontmatter as it stands,
 * so whatever the file holds that the app does not read survives. The name,
 * any other key and the body are left as they were, through the same
 * byte-preserving write a note's properties go through. `ifModified` refuses
 * the write when the file moved on since it was read, so an edit made in
 * another editor is not silently overwritten.
 */
export async function saveObjectType({
  fs,
  markdown,
  path,
  before,
  type,
  ifModified,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: VaultPath;
  /** The type as it was before the edit, which the file was read as. */
  before: ObjectType;
  type: ObjectType;
  ifModified?: number;
}): Promise<void> {
  await writeFrontmatterChanges({
    fs,
    markdown,
    path,
    values: (written) => typeFrontmatterChanges({ before, after: type, written }),
    ...(ifModified !== undefined && { ifModified }),
  });
}

/** A property to add to a type from one of its notes. */
export interface NewTypeProperty {
  readonly label: string;
  readonly kind: PropertyKind;
  /** The type a relation points at; the type itself when not given. */
  readonly target?: string | null;
  /** Whether a relation holds several notes. */
  readonly many?: boolean;
}

/**
 * Adds a property to a type — from a note of it, so it is on every note of the
 * type — and writes the type file. The key is the domain's, made from the name.
 * A relation's target is checked before anything is written.
 */
export async function addTypeProperty({
  fs,
  markdown,
  type,
  types,
  property,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  type: DefinedType;
  /** Every type name in the vault, which a relation's target must be one of. */
  types: readonly string[];
  property: NewTypeProperty;
}): Promise<PropertyDef> {
  const added = addProperty(type, { label: property.label, kind: property.kind });
  // `addProperty` puts the new property at the end, so there is always a last one.
  const [def] = added.properties.slice(-1) as [PropertyDef];
  const after =
    property.kind === 'relation'
      ? setRelation(added, {
          key: def.key,
          target: property.target ?? type.name,
          many: property.many ?? false,
          types,
        })
      : added;
  await saveObjectType({ fs, markdown, path: type.path, before: type, type: after });
  const [saved] = after.properties.filter((candidate) => candidate.key === def.key) as [
    PropertyDef,
  ];
  return saved;
}
