import {
  NEW_NOTE_CONTENTS,
  paraDefaultFor,
  quickAddBeside,
  quickAddProperties,
  splitFrontmatter,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import { createNote } from '../notes/create-note.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * Adds a note of a type from the add button: its title, and the few
 * properties asked for on the way.
 *
 * It starts from the type's template when the vault has one — so what a new
 * task holds is still decided in the vault — with the fields written into that
 * frontmatter through the byte-preserving write, and from an empty note of the
 * type otherwise. It goes to its type's home folder (#214); a type with none
 * goes where `quickAddBeside` says, and a taken name is numbered by
 * `createNote`, as capture's is.
 */
export async function quickAddNote({
  fs,
  markdown,
  type,
  name,
  values,
  template,
  beside,
  notePaths,
  today,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;
  type: Pick<ObjectType, 'name' | 'properties'>;
  name: string;
  /** The fields as filled in, by property key; only the type's own are written. */
  values: Readonly<Record<string, string>>;
  /** The template's text, or null when the type has none. */
  template: string | null;
  /** The note in view, which a task is added beside. */
  beside: VaultPath | null;
  notePaths: readonly VaultPath[];
  /** `YYYY-MM-DD`: a task added already finished is dated by it (ADR-0029). */
  today: string;
}): Promise<VaultPath> {
  const contents = quickAddContents({ markdown, type, values, template });
  return createNote({
    fs,
    markdown,
    today,
    name,
    beside: quickAddBeside({ type, beside }),
    notePaths,
    contents,
    properties: markdown.frontmatterProperties(splitFrontmatter(contents).frontmatter),
  });
}

/**
 * What a note added from the add button starts as: the type's template, or
 * an empty note of the type, with the fields filled in written into its
 * frontmatter through the byte-preserving write. A new Project starts as a
 * project (#213) unless its template or its fields say otherwise.
 */
export function quickAddContents({
  markdown,
  type,
  values,
  template,
}: {
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;
  type: Pick<ObjectType, 'name' | 'properties'>;
  values: Readonly<Record<string, string>>;
  template: string | null;
}): string {
  const { frontmatter, body } = splitFrontmatter(template ?? NEW_NOTE_CONTENTS);
  const filled = quickAddProperties({ type, fields: type.properties, values });
  const starting = { ...markdown.frontmatterProperties(frontmatter), ...filled };
  const changed = markdown.updateFrontmatter(frontmatter, {
    ...filled,
    ...paraDefaultFor({ type, starting }),
  });
  return changed + body;
}
