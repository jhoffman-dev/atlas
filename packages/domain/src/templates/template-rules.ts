/**
 * Templates: what a new note starts as.
 *
 * A template is an ordinary note in `.atlas/templates`, and its file name is
 * what connects it to what it makes — "Person" is the Person type's, "Daily"
 * is today's note's. These are the rules that read that connection, name a
 * new template, and say what a template made for a type starts with.
 */

import { KeyAsWritten } from '../markdown/frontmatter-key.ts';
import type { ObjectType } from '../types/property-def.ts';
import { MAX_NAME_BYTES, utf8Bytes } from '../vault/file-name-bytes.ts';
import {
  createVaultPath,
  parentVaultPath,
  vaultPathName,
  type VaultPath,
} from '../vault/vault-path.ts';
import { TEMPLATES_DIRECTORY } from '../vault/vault-visibility.ts';

/** The template today's note is made from. */
export const DAILY_TEMPLATE = 'Daily';

/** The template a captured task is made from. */
export const TASK_TEMPLATE = 'Task';

/** The template an artifact note starts from. */
export const ARTIFACT_TEMPLATE = 'Artifact';

/**
 * What a template is used for, besides the New menu that offers every one:
 * the notes of a type, today's note, a captured task, a saved artifact.
 */
export type TemplateUse =
  | { readonly kind: 'type'; readonly typeName: string; readonly typeLabel: string }
  | { readonly kind: 'daily' }
  | { readonly kind: 'capture' }
  | { readonly kind: 'artifact' };

const TEMPLATE_EXTENSION = '.md';
const MARKDOWN = /\.(md|markdown)$/i;

/** Characters no filesystem the vault may sit on accepts in a name. */
const UNUSABLE_IN_NAME = /[/\\:*?"<>|]|\p{Cc}/u;

/** A name as template lookups compare it: trimmed, case folded. */
const folded = (name: string): string => name.trim().normalize('NFC').toLowerCase();

/** A template's name: its file name without the extension. */
export function templateNameOf(path: VaultPath): string {
  return vaultPathName(path).replace(MARKDOWN, '');
}

/**
 * Where a template goes when it is renamed: the folder it is in, under the
 * extension it was saved with — only its name changes.
 */
export function renamedTemplatePath(from: VaultPath, name: string): VaultPath {
  const extension = MARKDOWN.exec(vaultPathName(from))?.[0] ?? TEMPLATE_EXTENSION;
  const folder = parentVaultPath(from);
  return createVaultPath(`${folder}/${name.trim()}${extension}`);
}

/** Where a template of this name is written. */
export function templatePathFor(name: string): VaultPath {
  return createVaultPath(`${TEMPLATES_DIRECTORY}/${name.trim()}${TEMPLATE_EXTENSION}`);
}

/**
 * Whether a template of this name is the one notes of `type` start from: it is
 * called what the type is called, by its label or its name, in any case — so
 * "Person" serves a type labelled Person and named `person`.
 */
export function isTemplateFor(templateName: string, type: Pick<ObjectType, 'name' | 'label'>) {
  return isTemplateNamed(templateName, type.label) || isTemplateNamed(templateName, type.name);
}

/**
 * Whether a template is the one asked for by `name`: the same once trimmed,
 * in any case and either Unicode normalisation, as the Mac's disk compares.
 */
export function isTemplateNamed(templateName: string, name: string): boolean {
  return folded(templateName) === folded(name);
}

/**
 * The order templates are listed and looked up in: by name as lookups compare
 * it, so two names a lookup takes for one sit side by side, then by `depth` —
 * the one nearer the top of the folder first, since a lookup takes the first —
 * then by the name as written. One fixed locale, so which template a name
 * means never depends on the machine's.
 */
export function compareTemplates(
  left: { readonly name: string; readonly depth: number },
  right: { readonly name: string; readonly depth: number },
): number {
  return (
    folded(left.name).localeCompare(folded(right.name), 'en') ||
    left.depth - right.depth ||
    left.name.localeCompare(right.name, 'en')
  );
}

/**
 * The name a template made for a type is given: the type's label, which is
 * how the type is shown everywhere else — or, when the label cannot be a file
 * name (`Q&A / Notes`, `.NET project`), the type's name, which is an
 * identifier and always can. Either one serves the type.
 */
export function typeTemplateName(type: Pick<ObjectType, 'name' | 'label'>): string {
  const label = type.label.trim();
  return templateNameProblem({ name: label, takenPaths: [] }) === null ? label : type.name;
}

/** The types no template of these names serves, in the order given: those "Edit template" would make one for. */
export function typesWithoutTemplate<Type extends Pick<ObjectType, 'name' | 'label'>>(
  types: readonly Type[],
  templateNames: readonly string[],
): Type[] {
  return types.filter((type) => !templateNames.some((name) => isTemplateFor(name, type)));
}

/** Everything that makes notes from a template of this name, in a fixed order. */
export function templateUses(
  templateName: string,
  types: readonly Pick<ObjectType, 'name' | 'label'>[],
): TemplateUse[] {
  const uses: TemplateUse[] = types
    .filter((type) => isTemplateFor(templateName, type))
    .map((type) => ({ kind: 'type', typeName: type.name, typeLabel: type.label }));
  const name = folded(templateName);
  if (name === folded(DAILY_TEMPLATE)) uses.push({ kind: 'daily' });
  if (name === folded(TASK_TEMPLATE)) uses.push({ kind: 'capture' });
  if (name === folded(ARTIFACT_TEMPLATE)) uses.push({ kind: 'artifact' });
  return uses;
}

/**
 * What stops being made from a template when it is renamed to `to`, or
 * deleted (`to` null): each of its uses the new name does not keep.
 */
export function usesLost({
  from,
  to,
  types,
}: {
  from: string;
  to: string | null;
  types: readonly Pick<ObjectType, 'name' | 'label'>[];
}): TemplateUse[] {
  const kept = to === null ? [] : templateUses(to, types).map(useKey);
  return templateUses(from, types).filter((use) => !kept.includes(useKey(use)));
}

const useKey = (use: TemplateUse) => (use.kind === 'type' ? `type:${use.typeName}` : use.kind);

/** A key as YAML reads it back unquoted: words, spaces, dashes, dots and apostrophes. */
const PLAIN_KEY = /^[\p{L}_][\p{L}\p{N}_\- .'’]*$/u;
/** Plain words YAML reads as something other than a string. */
const NON_STRING_KEY = /^(?:true|false|yes|no|on|off|null|y|n)$/i;

/**
 * A frontmatter key as written: bare when YAML reads it back as the same text,
 * double-quoted otherwise (`"a: b"`, `"#ref"`). JSON's quoting is YAML's.
 */
function writtenKey(key: string): string {
  const plain = PLAIN_KEY.test(key) && !NON_STRING_KEY.test(key) && key.trimEnd() === key;
  return plain ? key : JSON.stringify(key);
}

/**
 * What a template made for a type starts with: the type it makes, and each of
 * the type's properties as an empty key — the shape every template in a new
 * vault has, so filling in a default is typing after a colon. Written as
 * `role:` with nothing after it rather than `role: ""`, which would give every
 * new note an empty string instead of no value.
 */
export function typeTemplateFrontmatter(
  type: Pick<ObjectType, 'name' | 'properties'>,
): Record<string, unknown> {
  const keys = type.properties
    .map((property) => property.key)
    .filter((key) => key !== 'type')
    .map((key) => [key, new KeyAsWritten(`${writtenKey(key)}:\n`)] as const);
  return { type: type.name, ...Object.fromEntries(keys) };
}

/**
 * Why a template cannot be called this, or null. Blank, a character a file
 * name cannot hold, a leading or trailing dot (one hides it, the other some
 * disks drop, as `cleanEntryName` does for every note), too long, or the name
 * of a template already in the same folder, under either extension — in any
 * case and either Unicode normalisation, since the Mac's disk takes those for
 * the same file. `except` is the template's own path when it is being
 * renamed: it is renamed where it is, and a change of case is allowed.
 */
export function templateNameProblem({
  name,
  takenPaths,
  except = null,
}: {
  name: string;
  takenPaths: readonly string[];
  except?: string | null;
}): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name the template.';
  if (UNUSABLE_IN_NAME.test(trimmed)) {
    return 'A template’s name cannot hold / \\ : * ? " < > or |.';
  }
  if (trimmed.startsWith('.')) return 'A template’s name cannot start with a dot.';
  if (trimmed.endsWith('.')) return 'A template’s name cannot end with a dot.';
  if (utf8Bytes(`${trimmed}${TEMPLATE_EXTENSION}`) > MAX_NAME_BYTES) {
    return 'A template’s name is too long for a file name.';
  }
  const folder = folded(
    except === null ? TEMPLATES_DIRECTORY : parentVaultPath(createVaultPath(except)),
  );
  const wanted = folded(trimmed);
  const own = except === null ? null : folded(except);
  const clash = takenPaths.some(
    (taken) =>
      folded(parentVaultPath(createVaultPath(taken))) === folder &&
      folded(templateNameOf(createVaultPath(taken))) === wanted &&
      folded(taken) !== own,
  );
  return clash ? `There is already a template called “${trimmed}”.` : null;
}
