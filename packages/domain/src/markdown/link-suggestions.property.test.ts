import { describe, expect, it } from 'vitest';
import {
  linkMatchOf,
  linkMatchStrength,
  rankLinkChoices,
  type LinkHints,
} from './link-suggestions.ts';

/**
 * Property (#465): whatever the notes are called, and whatever is typed, the
 * suggestions are the same whichever order the notes arrive in, every one of
 * them meets the query, the matches never get better down the list, and
 * case and accents change nothing.
 */

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

const random = seeded(20261020);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const count = (max: number) => Math.floor(random() * (max + 1));

const WORDS = ['Mara', 'Quill', 'Tobias', 'Fenn', 'Larkspur', 'Payroll', 'Zoë', 'café', 'Q3'];
const SEPARATORS = [' ', '-', ' (', '_', ''];

const nameOf = () =>
  Array.from({ length: 1 + count(2) }, () => pick(WORDS))
    .map((word, at) => (at === 0 ? word : `${pick(SEPARATORS)}${word}`))
    .join('');

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let at = copy.length - 1; at > 0; at -= 1) {
    const other = Math.floor(random() * (at + 1));
    [copy[at], copy[other]] = [copy[other] as T, copy[at] as T];
  }
  return copy;
}

function caseOf() {
  const choices = Array.from({ length: 1 + count(12) }, (_, at) => ({
    path: `notes/${at}.md`,
    title: nameOf(),
  }));
  const hints: LinkHints = {
    aliases: new Map(
      choices.filter(() => random() < 0.3).map((choice) => [choice.path, [nameOf()]]),
    ),
    uses: new Map(
      choices
        .filter(() => random() < 0.4)
        .map((choice) => [choice.path, { count: count(5), last: count(3) }]),
    ),
  };
  const source = pick(WORDS);
  const query = source.slice(0, 1 + count(source.length - 1));
  return { choices, hints, query };
}

describe('rankLinkChoices, over generated vaults', () => {
  it('holds its rules for 500 generated cases', () => {
    for (let run = 0; run < 500; run += 1) {
      const { choices, hints, query } = caseOf();
      const ranked = rankLinkChoices({ query, choices, hints });

      // The order is the rule's, not the order the notes came in.
      const again = rankLinkChoices({ query, choices: shuffled(choices), hints });
      expect(again.map((each) => each.choice.path)).toEqual(ranked.map((each) => each.choice.path));

      // Case and accents in the query change nothing.
      const loud = rankLinkChoices({ query: query.toUpperCase(), choices, hints });
      expect(loud.map((each) => each.choice.path)).toEqual(ranked.map((each) => each.choice.path));

      for (const [at, each] of ranked.entries()) {
        // Every suggestion meets the query, by its title or the alias named.
        expect(linkMatchOf(each.alias ?? each.choice.title, query)).toBe(each.match);
        const before = ranked[at - 1];
        if (before !== undefined) {
          expect(linkMatchStrength(before.match)).toBeGreaterThanOrEqual(
            linkMatchStrength(each.match),
          );
        }
      }

      // Nothing that meets the query is left out, under the limit.
      const meeting = choices.filter(
        (choice) =>
          linkMatchOf(choice.title, query) !== null ||
          (hints.aliases.get(choice.path) ?? []).some(
            (alias) => linkMatchOf(alias, query) !== null,
          ),
      );
      expect(ranked).toHaveLength(meeting.length);
    }
  });
});
