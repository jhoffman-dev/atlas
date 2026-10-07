import { nextAvailableNotePath, VAULT_ROOT, type ObjectType, type VaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { quickAddContents } from '../quick-add/quick-add-note.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { findTypeTemplate, loadTemplates, readTemplate } from './templates.ts';

/**
 * "New book" at the foot of a type's table: a note that already says it is
 * one, at the top of the vault, named "New Book" until it is renamed — made
 * from the type's template when it has one, as the add button's notes are, so
 * editing the template changes what every new note of the type starts as.
 */
export async function createNoteOfType({
  fs,
  markdown,
  type,
  notePaths,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'updateFrontmatter'>;
  type: Pick<ObjectType, 'name' | 'label' | 'properties'>;
  notePaths: readonly string[];
}): Promise<VaultPath> {
  const template = findTypeTemplate(await loadTemplates({ fs }), type);
  const text = template === null ? null : await readTemplate({ fs, template });
  const contents = quickAddContents({ markdown, type, values: {}, template: text });
  const path = nextAvailableNotePath({
    folder: VAULT_ROOT,
    name: `New ${type.label}`,
    taken: new Set(notePaths),
  });
  await fs.createNote({ path, contents });
  return path;
}
