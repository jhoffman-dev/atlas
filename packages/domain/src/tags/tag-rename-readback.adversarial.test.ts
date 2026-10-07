/**
 * Adversarial pass on Phase 20's rename through the API: a name the rename
 * accepts must be written so that reading the note back finds that name, or
 * the rename quietly turns one tag into another (A20 API review). Where the
 * grammar (ADR-0018) has no way to write it, the rename is refused instead.
 */
import { describe, expect, it } from 'vitest';
import { findTags } from './tag-grammar.ts';
import { renameTagInBody } from './note-tags.ts';
import { formatTag, renamedTagName, tagRenameProblem } from './tag-name.ts';

const namesIn = (text: string) => findTags(text).map((tag) => tag.name);

const renamed = (body: string, to: string) =>
  renameTagInBody({ body, ranges: [{ start: 0, end: body.length }], rename: { from: 'idea', to } });

describe('a new name whose last word is one letter', () => {
  // `#plan a#` is `#plan` followed by `a#`, as `C#` is: no form of it reads back.
  it.each([['plan a'], ['vitamin c'], ['x/y z']])(
    'is refused, since it cannot read back: %s',
    (to) => {
      expect(namesIn(`Body ${formatTag(to)} here`)).not.toEqual([to]);
      expect(tagRenameProblem({ from: 'idea', to })).toMatch(/one-letter word/);
    },
  );
});

describe('renaming a tag written directly before other text into a name with a space', () => {
  // `#my tag#` closes only before a space or punctuation: before `#`, `_` or a
  // letter it reads as `#my`, and no other spelling of it closes there.
  it.each([
    ['a # right after it', 'Body #idea#x\n'],
    ['an _ right after it', 'Body #idea_ here\n'],
  ])('leaves the note as it was, and says why, when %s', (_, body) => {
    const result = renamed(body, 'my tag');
    expect(result.body).toBe(body);
    expect(result.count).toBe(0);
    expect(result.problem).toMatch(/#my tag#/);
  });

  it('still renames where the closed name can be read back', () => {
    const result = renamed('Body #idea, and #idea.\n', 'my tag');
    expect(namesIn(result.body)).toEqual(['my tag', 'my tag']);
    expect(result.problem).toBeNull();
  });
});

describe('properties of a rename written back', () => {
  /** A small seeded generator, so a failure is the same failure every run. */
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const random = seeded(20260927);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const WORDS = ['a', 'b', 'x1', 'my', 'tag', 'é', 'plan', 'q-2', 'to_do', '9'];
  const AROUND = ['', ' ', '#', '_', '__', 'x', '/', '/y', '.', ',', '-', ')', 'é', '#x', ' z#'];
  const cases = Array.from({ length: 600 }, () => {
    const words = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(WORDS));
    const to = random() < 0.3 ? `${pick(WORDS)}/${words.join(' ')}` : words.join(' ');
    const use = pick(['#idea', '#Idea', '#idea/sub', '#idea#']);
    return { to, body: `${pick(['', 'Body ', '('])}${use}${pick(AROUND)}${pick(AROUND)}` };
  });
  const accepted = cases.filter(({ to }) => tagRenameProblem({ from: 'idea', to }) === null);

  it('reads every renamed use back as the new name, or leaves the note and says why', () => {
    let written = 0;
    let refused = 0;
    for (const { to, body } of accepted) {
      const before = findTags(body).map((tag) => tag.name);
      const result = renamed(body, to);
      if (result.problem === null) {
        const expected = before.map((name) => renamedTagName({ name, from: 'idea', to }) ?? name);
        expect(namesIn(result.body), `${body} → ${to}`).toEqual(expected);
        written += 1;
      } else {
        expect(result.body).toBe(body);
        refused += 1;
      }
    }
    // Both outcomes are exercised, so neither assertion above is vacuous.
    expect(written).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(10);
  });

  it('accepts only names that read back whole once written on their own', () => {
    for (const { to } of accepted) expect(namesIn(`Body ${formatTag(to)} here`)).toEqual([to]);
  });
});
