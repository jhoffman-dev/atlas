import {
  createVaultPath,
  isTemplateNote,
  joinVaultPath,
  NEW_NOTE_CONTENTS,
  nextAvailableNotePath,
  renamedTemplatePath,
  TEMPLATES_DIRECTORY,
  templateNameProblem,
  templatePathFor,
  templateUses,
  typeTemplateFrontmatter,
  typeTemplateName,
  typesWithoutTemplate,
  VAULT_ROOT,
  vaultPathName,
  type ObjectType,
  type TemplateUse,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { OpenEditorsPort, VaultFsPort } from '../vault/ports.ts';
import { findTypeTemplate, loadTemplates, type NoteTemplate } from './templates.ts';

/** Refused before anything is touched, in the rule's own words for the person. */
export class TemplateRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateRefusedError';
  }
}

/** A template as the Templates page lists it: what it is and what makes notes from it. */
export interface TemplateRow extends NoteTemplate {
  readonly uses: readonly TemplateUse[];
}

/** Every template, with what uses each, and the types that have none yet. */
export interface TemplateCatalog<Type> {
  readonly templates: readonly TemplateRow[];
  readonly typesWithout: readonly Type[];
}

type TypeShape = Pick<ObjectType, 'name' | 'label' | 'properties'>;

/** Reads the templates folder and says what each template is for. */
export async function loadTemplateCatalog<Type extends TypeShape>({
  fs,
  types,
}: {
  fs: VaultFsPort;
  types: readonly Type[];
}): Promise<TemplateCatalog<Type>> {
  const templates = await loadTemplates({ fs });
  return {
    templates: templates.map((template) => ({
      ...template,
      uses: templateUses(template.name, types),
    })),
    typesWithout: typesWithoutTemplate(
      types,
      templates.map((template) => template.name),
    ),
  };
}

/**
 * The template notes of `type` start from — made, named after the type and
 * holding its properties, when the type has none — so "Edit template" always
 * lands on something to edit. Answers its path and whether it was just made.
 */
export async function ensureTypeTemplate({
  fs,
  markdown,
  type,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'updateFrontmatter'>;
  type: TypeShape;
}): Promise<{ path: VaultPath; created: boolean }> {
  const templates = await loadTemplates({ fs });
  const existing = findTypeTemplate(templates, type);
  if (existing !== null) return { path: existing.path, created: false };
  try {
    const path = await createTemplate({
      fs,
      markdown,
      name: typeTemplateName(type),
      type,
      templates,
    });
    return { path, created: true };
  } catch (cause) {
    // Pressed twice, the second press finds the file the first just made:
    // the disk refuses to overwrite it, and that template is what was wanted.
    const made = findTypeTemplate(await loadTemplates({ fs }), type);
    if (made === null) throw cause;
    return { path: made.path, created: false };
  }
}

/**
 * Writes a new template: one for `type` starts as a note of that type with
 * each of its properties left empty; one for no type starts blank. Refused
 * when the name cannot be a template's.
 */
export async function createTemplate({
  fs,
  markdown,
  name,
  type,
  templates,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'updateFrontmatter'>;
  name: string;
  type: TypeShape | null;
  /** The templates already there, which the name must not clash with. */
  templates: readonly NoteTemplate[];
}): Promise<VaultPath> {
  const problem = templateNameProblem({ name, takenPaths: templates.map(({ path }) => path) });
  if (problem !== null) throw new TemplateRefusedError(problem);
  const folder = await ensureFolder({ fs, folder: createVaultPath(TEMPLATES_DIRECTORY) });
  const path = joinVaultPath(folder, vaultPathName(templatePathFor(name)));
  const contents =
    type === null
      ? NEW_NOTE_CONTENTS
      : markdown.updateFrontmatter(null, typeTemplateFrontmatter(type)) + NEW_NOTE_CONTENTS;
  await fs.createNote({ path, contents });
  return path;
}

/**
 * Renames a template within the templates folder, and every pane showing it
 * follows. Its contents are not read or rewritten — only its name changes,
 * which also changes which type it serves. Answers where it went.
 */
export async function renameTemplate({
  fs,
  editors,
  template,
  name,
  templates,
}: {
  fs: VaultFsPort;
  editors: Pick<OpenEditorsPort, 'flush' | 'follow'>;
  template: NoteTemplate;
  name: string;
  templates: readonly NoteTemplate[];
}): Promise<VaultPath> {
  refuseUnlessTemplate(template.path);
  const problem = templateNameProblem({
    name,
    takenPaths: templates.map(({ path }) => path),
    except: template.path,
  });
  if (problem !== null) throw new TemplateRefusedError(problem);
  const to = renamedTemplatePath(template.path, name);
  if (to === template.path) return to;
  await editors.flush([template.path]);
  const move = { from: template.path, to };
  await fs.moveEntry(move);
  editors.follow(move);
  return to;
}

/**
 * Puts a template in the system Trash, where it can be got back; panes
 * showing it let go of their unsaved typing. Notes already made from it are
 * untouched — they were copies.
 */
export async function deleteTemplate({
  fs,
  editors,
  path,
}: {
  fs: VaultFsPort;
  editors: Pick<OpenEditorsPort, 'abandon'>;
  path: VaultPath;
}): Promise<void> {
  refuseUnlessTemplate(path);
  await fs.trashEntry({ path });
  editors.abandon([path]);
}

/**
 * Turns a template back into one of the vault's notes: the file moves to the
 * top of the vault under its own name — numbered when a note there has it —
 * with its contents untouched, and panes showing it follow. For a template
 * that was really a note all along: its links resolve to it again, and it
 * stops being what new notes start as. Answers where it went.
 */
export async function moveTemplateToNotes({
  fs,
  editors,
  path,
}: {
  fs: VaultFsPort;
  editors: Pick<OpenEditorsPort, 'flush' | 'follow'>;
  path: VaultPath;
}): Promise<VaultPath> {
  refuseUnlessTemplate(path);
  const taken = new Set<string>((await fs.listDirectory(VAULT_ROOT)).map((entry) => entry.path));
  const to = nextAvailableNotePath({ folder: VAULT_ROOT, name: vaultPathName(path), taken });
  await editors.flush([path]);
  const move = { from: path, to };
  await fs.moveEntry(move);
  editors.follow(move);
  return to;
}

/** Only a template is renamed, deleted or moved here: anything else has its own way. */
function refuseUnlessTemplate(path: VaultPath): void {
  if (!isTemplateNote(path)) throw new TemplateRefusedError('That is not a template.');
}
