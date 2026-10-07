/**
 * Adversarial probe of issue #16 (ADR-0026): the frontmatter "Edit template"
 * writes for a type that has none, through the real frontmatter writer.
 */
import { describe, expect, it } from 'vitest';
import { typeTemplateFrontmatter, type PropertyDef } from '@atlas/domain';
import { parseFrontmatterProperties } from './frontmatter.ts';
import { updateFrontmatter } from './frontmatter-write.ts';

const property = (key: string): PropertyDef => ({
  key,
  kind: 'text',
  label: key,
  required: false,
  options: [],
  target: null,
  many: false,
});

const templateFor = (keys: readonly string[]) =>
  updateFrontmatter(
    null,
    typeTemplateFrontmatter({ name: 'person', properties: keys.map(property) }),
  );

const keysOf = (written: string) =>
  Object.keys(parseFrontmatterProperties(written.replace(/^---\n|---\n$/g, '')));

describe('a new type template holds every property its type declares', () => {
  it('keeps an identifier key, empty', () => {
    const written = templateFor(['role']);
    expect(keysOf(written)).toEqual(['type', 'role']);
    expect(parseFrontmatterProperties(written.replace(/^---\n|---\n$/g, ''))['role']).toBeNull();
  });

  // A type file in `.atlas/types` is an ordinary note James may write by
  // hand, and parseObjectType keeps any key YAML can hold — so a quoted key
  // reaches typeTemplateFrontmatter, which writes it unquoted as `${key}:`.
  it.each(['due date', 'a: b', '#ref', 'it’s'])('keeps the hand-written key %j', (key) => {
    expect(keysOf(templateFor([key]))).toEqual(['type', key]);
  });
});
