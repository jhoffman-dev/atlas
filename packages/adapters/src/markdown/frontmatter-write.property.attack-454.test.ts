/**
 * Attack on PR #454: a seeded property over a broader generator than #395's
 * and #430's (see frontmatter-write-cases.attack-454.ts) — two changes at once,
 * removals, added keys, empty lists and maps, |-/|+/>, same-column lists,
 * comments between items and at column 0, whitespace-only lines, unicode.
 */
import { describe, expect, it } from 'vitest';
import { updateFrontmatter } from './frontmatter-write.ts';
import { frontmatterProblem, parseFrontmatterProperties } from './frontmatter.ts';
import { generated, seeded } from './frontmatter-write-cases.attack-454.ts';

const cases = (() => {
  const random = seeded(454);
  return Array.from({ length: 2000 }, () => generated(random));
})();

describe('#454 property: every value reads back as set, every other as it was', () => {
  it.each(cases.map((one, at) => [at, one.name, one] as const))(
    'case %i: %s',
    (_, __, { original, changes, expected }) => {
      const written = updateFrontmatter(original, changes);
      expect(JSON.parse(JSON.stringify(parseFrontmatterProperties(written)))).toEqual(
        JSON.parse(JSON.stringify(expected)),
      );
    },
  );
});

describe('#454 property: a readable block stays readable', () => {
  it.each(cases.map((one, at) => [at, one.name, one] as const))(
    'case %i: %s',
    (_, __, { original, changes }) => {
      expect(frontmatterProblem(original)).toBeNull();
      expect(frontmatterProblem(updateFrontmatter(original, changes))).toBeNull();
    },
  );
});
