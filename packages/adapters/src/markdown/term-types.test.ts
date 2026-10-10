import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALIASES_KEY,
  parseObjectType,
  splitFrontmatter,
  TERM_KINDS,
  TERM_TYPE,
  VARIANTS_KEY,
  type ObjectType,
} from '@atlas/domain';
import { parseFrontmatterProperties } from './frontmatter.ts';

/*
 * The Term, Person and Company types this repository's vault ships (P28-05),
 * read with the YAML reader every type file is read with, hold the keys the
 * vocabulary reads.
 */

const root = new URL('../../../../', import.meta.url);

function shippedType(name: string): ObjectType {
  const file = readFileSync(new URL(`vault/.atlas/types/${name}.md`, root), 'utf8');
  return parseObjectType(parseFrontmatterProperties(splitFrontmatter(file).frontmatter));
}

describe('the Term type this vault ships', () => {
  it('holds the misheard spellings as a free list, its kind as a choice, and what it refers to', () => {
    const type = shippedType('term');
    expect(type.name).toBe(TERM_TYPE);
    expect(type.icon).toBe('term');
    const byKey = new Map(type.properties.map((property) => [property.key, property]));
    expect(byKey.get(VARIANTS_KEY)).toMatchObject({ kind: 'multiSelect', options: [] });
    expect(byKey.get('kind')).toMatchObject({ kind: 'select', options: [...TERM_KINDS] });
    expect(byKey.get('refers_to')).toMatchObject({ kind: 'relation', target: 'company' });
  });
});

describe('the Person and Company types this vault ships', () => {
  it.each(['person', 'company'])('give %s an aliases list free of fixed options', (name) => {
    const aliases = shippedType(name).properties.find((property) => property.key === ALIASES_KEY);
    expect(aliases).toMatchObject({ kind: 'multiSelect', options: [], label: 'Also spelt' });
  });
});
