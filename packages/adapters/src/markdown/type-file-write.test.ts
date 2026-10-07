/**
 * A type edited in the app, written back through the real frontmatter writer.
 *
 * The type editor rewrites `label`, `icon` and `properties`; everything else in
 * the file — `name`, a key it does not know, a comment, the body — must come
 * back as it was, and what it wrote must parse to exactly the edited type.
 */
import { describe, expect, it } from 'vitest';
import {
  addProperty,
  moveProperty,
  renameProperty,
  parseObjectType,
  renameOption,
  setRelation,
  splitFrontmatter,
  typeFrontmatterChanges,
} from '@atlas/domain';
import { parseFrontmatterProperties } from './frontmatter.ts';
import { updateFrontmatter } from './frontmatter-write.ts';

const TASK_FILE = [
  '---',
  '# The type this project uses.',
  'name: task',
  'label: Task',
  'owner: james',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, next, doing, review, done]',
  '    required: true',
  '  phase: number',
  '---',
  '',
  '# Task',
  '',
  'Every file in `vault/tasks` declares it.',
  '',
].join('\n');

function edit(text: string, change: (type: ReturnType<typeof parseObjectType>) => typeof type) {
  const { frontmatter, body } = splitFrontmatter(text);
  const written = parseFrontmatterProperties(frontmatter);
  const type = parseObjectType(written);
  const edited = change(type);
  // The way the app saves a type: only what the edit changed (saveObjectType).
  const changes = typeFrontmatterChanges({ before: type, after: edited, written });
  return { edited, text: updateFrontmatter(frontmatter, changes) + body };
}

describe('writing an edited type file', () => {
  it('parses back to the edited type', () => {
    const { edited, text } = edit(TASK_FILE, (type) => {
      const renamed = renameOption(type, { key: 'status', from: 'review', to: 'in review' }).type;
      const withProject = addProperty(renamed, { label: 'Project', kind: 'relation' });
      return setRelation(withProject, {
        key: 'project',
        target: 'project',
        many: false,
        types: ['project'],
      });
    });
    const { frontmatter } = splitFrontmatter(text);
    expect(parseObjectType(parseFrontmatterProperties(frontmatter))).toEqual(edited);
  });

  it('keeps the name, keys it does not own, the comment and the body', () => {
    const { text } = edit(TASK_FILE, (type) => ({ ...type, label: 'Chore' }));
    expect(text).toContain('# The type this project uses.\nname: task\nlabel: Chore\nowner: james');
    expect(text.endsWith('---\n\n# Task\n\nEvery file in `vault/tasks` declares it.\n')).toBe(true);
  });

  it('writes a colour the renamed option kept', () => {
    const { text } = edit(
      TASK_FILE,
      (type) => renameOption(type, { key: 'status', from: 'review', to: 'in review' }).type,
    );
    expect(text).toMatch(/colors:\n\s+in review: review/);
  });
});

describe('writing an edited type file — adversarial', () => {
  // The map of properties is reconciled in place, keeping the order its keys
  // were found in, so a reorder made in the type editor never reaches the file.
  it('writes the properties in the order the editor moved them to', () => {
    const { edited, text } = edit(TASK_FILE, (type) => moveProperty(type, { key: 'phase', to: 0 }));
    expect(edited.properties.map((property) => property.key)).toEqual(['phase', 'status']);
    const { frontmatter } = splitFrontmatter(text);
    const reread = parseObjectType(parseFrontmatterProperties(frontmatter));
    expect(reread.properties.map((property) => property.key)).toEqual(['phase', 'status']);
  });

  // The renamed key is a new pair, pushed after the others.
  it('keeps a renamed property where it stood', () => {
    const { text } = edit(
      TASK_FILE,
      (type) => renameProperty(type, { key: 'status', newKey: 'stage', label: 'Stage' }).type,
    );
    const { frontmatter } = splitFrontmatter(text);
    const reread = parseObjectType(parseFrontmatterProperties(frontmatter));
    expect(reread.properties.map((property) => property.key)).toEqual(['stage', 'phase']);
  });

  // A key the editor does not know, written by hand inside one property's spec,
  // is dropped by any edit to that property.
  it('keeps a key it does not own inside a property it edits', () => {
    const withHint = TASK_FILE.replace(
      '    required: true\n',
      '    required: true\n    hint: Where the work is\n',
    );
    const { text } = edit(
      withHint,
      (type) => renameOption(type, { key: 'status', from: 'review', to: 'in review' }).type,
    );
    expect(text).toContain('hint: Where the work is');
  });
});
