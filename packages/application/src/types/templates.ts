import {
  compareTemplates,
  createVaultPath,
  DAILY_TEMPLATE,
  fitFileNameStem,
  HIDDEN_DIRECTORY_NAMES,
  isMarkdownFile,
  isTemplateFor,
  isTemplateNamed,
  isWithinWalk,
  joinVaultPath,
  noteFileName,
  TASK_TEMPLATE,
  templateNameOf,
  TEMPLATES_DIRECTORY,
  vaultPathDepth,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

/** Where a vault keeps its note templates. */
export const TEMPLATES_FOLDER = TEMPLATES_DIRECTORY;

export interface NoteTemplate {
  /** The file the template lives in. */
  readonly path: VaultPath;
  /** What to call it in the menu — the filename without its extension. */
  readonly name: string;
}

/**
 * The templates a vault offers.
 *
 * A template is an ordinary note: its frontmatter and body are copied as they
 * are. That means a template can be written and edited in the app itself, with
 * no separate format to learn.
 */
export async function loadTemplates({ fs }: { fs: VaultFsPort }): Promise<NoteTemplate[]> {
  const paths = await templatePathsIn(fs, createVaultPath(TEMPLATES_FOLDER));
  return paths
    .map((path) => ({ path, name: templateNameOf(path) }))
    .sort((left, right) =>
      compareTemplates(
        { name: left.name, depth: vaultPathDepth(left.path) },
        { name: right.name, depth: vaultPathDepth(right.path) },
      ),
    );
}

const SKIPPED_FOLDERS = new Set(HIDDEN_DIRECTORY_NAMES.map((name) => name.toLowerCase()));

/**
 * Every markdown file in `folder` and the folders inside it, `.md` or
 * `.markdown`: the templates folder leaves the vault's notes whole (ADR-0026),
 * so a template kept in a subfolder has nowhere else to be reached.
 */
async function templatePathsIn(fs: VaultFsPort, folder: VaultPath): Promise<VaultPath[]> {
  let entries;
  try {
    entries = await fs.listDirectory(folder);
  } catch {
    // A vault with no templates folder simply offers none, and a subfolder
    // that cannot be read offers none while the rest still do.
    return [];
  }
  const files = entries.filter((entry) => entry.kind === 'file' && isMarkdownFile(entry));
  const folders = entries.filter(
    (entry) =>
      entry.kind === 'directory' &&
      !SKIPPED_FOLDERS.has(entry.name.toLowerCase()) &&
      // No deeper than the vault's own walk reads, whatever a link loops back to.
      isWithinWalk(joinVaultPath(entry.path, 'note.md')),
  );
  const nested = await Promise.all(folders.map((entry) => templatePathsIn(fs, entry.path)));
  return [...files.map((entry) => entry.path), ...nested.flat()];
}

/** Reads a template's text, ready to be written into a new note. */
export async function readTemplate({
  fs,
  template,
}: {
  fs: VaultFsPort;
  template: NoteTemplate;
}): Promise<string> {
  const { text } = await fs.readTextFile(template.path);
  return text;
}

/**
 * The template a captured task is made from: one called Task, when the vault
 * has one, so what a captured note contains is decided in the vault rather than
 * in the app.
 */
export function findTaskTemplate(templates: readonly NoteTemplate[]): NoteTemplate | null {
  return findTemplateNamed(templates, TASK_TEMPLATE);
}

/** The template today's note is made from: one called Daily, when there is one. */
export function findDailyTemplate(templates: readonly NoteTemplate[]): NoteTemplate | null {
  return findTemplateNamed(templates, DAILY_TEMPLATE);
}

/** A template by the name the menu shows, in any case or normalisation; null when there is none. */
export function findTemplateNamed<Template extends NoteTemplate>(
  templates: readonly Template[],
  name: string,
): Template | null {
  return templates.find((template) => isTemplateNamed(template.name, name)) ?? null;
}

/**
 * The template notes of `type` start from: one called what the type is
 * called — its label first, then its name — or null when it has none.
 */
export function findTypeTemplate(
  templates: readonly NoteTemplate[],
  type: Pick<ObjectType, 'name' | 'label'>,
): NoteTemplate | null {
  return (
    findTemplateNamed(templates, type.label) ??
    templates.find((template) => isTemplateFor(template.name, type)) ??
    null
  );
}

/** The name a new note from this template starts with, short enough to be a file's name. */
export function templateNoteName(template: NoteTemplate): string {
  const name = noteFileName(`New ${template.name}`).replace(/\.(md|markdown)$/i, '');
  return fitFileNameStem(name, '.md');
}
