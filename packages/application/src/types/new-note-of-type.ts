import { createVaultPath, type ObjectType, type VaultPath } from '@dfai/domain';
import { createNote } from '../notes/create-note.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { quickAddContents } from '../quick-add/quick-add-note.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { findTypeTemplate, loadTemplates, readTemplate } from './templates.ts';

/**
 * "New book" at the foot of a type's table: a note that already says it is
 * one, in its type's home folder or else at the top of the vault (#214), named "New Book" until it is renamed — made
 * from the type's template when it has one, as quick add's notes are, so
 * editing the template changes what every new note of the type starts as.
 */
export async function createNoteOfType({
  fs,
  markdown,
  type,
  notePaths,
  today,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;
  type: Pick<ObjectType, 'name' | 'label' | 'properties'>;
  notePaths: readonly string[];
  /** `YYYY-MM-DD`: the task rules date a task made already finished by it (ADR-0029). */
  today: string;
}): Promise<VaultPath> {
  const template = findTypeTemplate(await loadTemplates({ fs }), type);
  const text = template === null ? null : await readTemplate({ fs, template });
  const contents = quickAddContents({ markdown, type, values: {}, template: text });
  return createNote({
    fs,
    markdown,
    today,
    name: `New ${type.label}`,
    beside: null,
    notePaths: notePaths.map(createVaultPath),
    contents,
  });
}
