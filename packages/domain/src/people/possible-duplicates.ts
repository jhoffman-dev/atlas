import type { DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { vocabularyKey } from '../terms/spelling.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { addressesMatch, addressParts, type LocalMatch } from './person-similarity.ts';

/** A person as the possible-duplicates list compares them: a directory entry, minus their company. */
export type DuplicateCandidate = Pick<DirectoryPerson, 'path' | 'name' | 'emails' | 'aliases'>;

/** Why two people may be one. */
export type DuplicateReason =
  | { readonly kind: 'same-email'; readonly email: string }
  | { readonly kind: 'same-name' }
  | { readonly kind: 'alias'; readonly alias: string }
  | {
      readonly kind: 'similar-email';
      readonly left: string;
      readonly right: string;
      readonly local: LocalMatch;
      readonly sameDomain: boolean;
    };

/** Two people who may be one, with every reason found; `left` sorts before `right` by path. */
export interface DuplicatePair {
  readonly key: string;
  readonly left: DuplicateCandidate;
  readonly right: DuplicateCandidate;
  readonly reasons: readonly DuplicateReason[];
}

/** What a pair is remembered by: the two paths, in order, so the pair is one key either way round. */
export function duplicatePairKey(left: VaultPath, right: VaultPath): string {
  return [left, right].sort().join('\u0000');
}

/** How sure a reason is, most sure first: the list is ordered by a pair's surest reason. */
const STRENGTH: Readonly<Record<string, number>> = {
  'same-email': 0,
  'same-name': 1,
  alias: 2,
  same: 3,
  'first-name': 4,
  typo: 5,
};

const strength = (reason: DuplicateReason): number =>
  STRENGTH[reason.kind === 'similar-email' ? reason.local : reason.kind] ?? 9;

/**
 * Every pair of people who may be one person (#464), not counting pairs
 * already said not to be (`dismissed`, by {@link duplicatePairKey}):
 *
 * - the same address on both;
 * - the same name — `Tobias Fenn.md` and `People/Tobias Fenn.md` — spelt as the Terms page compares spellings;
 * - an alias of one that is the other's name;
 * - addresses alike by {@link addressesMatch}: the same or a near domain, and local parts
 *   that are one with their dots dropped, a first name and a full one, or a typo apart.
 *
 * Surest first, then by name. Addresses are compared within each domain and
 * its near neighbours only, so a vault of thousands is not compared all to all.
 */
export function possibleDuplicates({
  people,
  dismissed,
}: {
  people: readonly DuplicateCandidate[];
  dismissed: ReadonlySet<string>;
}): DuplicatePair[] {
  const pairs = new Map<
    string,
    { left: DuplicateCandidate; right: DuplicateCandidate; reasons: DuplicateReason[] }
  >();
  const add = (a: DuplicateCandidate, b: DuplicateCandidate, reason: DuplicateReason) => {
    if (a.path === b.path) return;
    const key = duplicatePairKey(a.path, b.path);
    if (dismissed.has(key)) return;
    const [left, right] = a.path < b.path ? [a, b] : [b, a];
    const pair = pairs.get(key) ?? { left, right, reasons: [] };
    if (!pair.reasons.some((known) => sameReason(known, reason))) pair.reasons.push(reason);
    pairs.set(key, pair);
  };
  namePairs(people, add);
  emailPairs(people, add);
  return [...pairs]
    .map(([key, pair]) => ({ key, ...pair, reasons: [...pair.reasons].sort(byStrength) }))
    .sort(
      (a, b) =>
        strength(a.reasons[0]!) - strength(b.reasons[0]!) ||
        a.left.name.localeCompare(b.left.name) ||
        a.key.localeCompare(b.key),
    );
}

type AddPair = (a: DuplicateCandidate, b: DuplicateCandidate, reason: DuplicateReason) => void;

const byStrength = (a: DuplicateReason, b: DuplicateReason) => strength(a) - strength(b);

function sameReason(a: DuplicateReason, b: DuplicateReason): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Pairs by name: the same name, or an alias of one that is the other's name. */
function namePairs(people: readonly DuplicateCandidate[], add: AddPair): void {
  const byName = new Map<string, DuplicateCandidate[]>();
  for (const person of people) {
    const key = vocabularyKey(person.name);
    if (key !== '') byName.set(key, [...(byName.get(key) ?? []), person]);
  }
  for (const named of byName.values()) {
    named.forEach((a, at) => named.slice(at + 1).forEach((b) => add(a, b, { kind: 'same-name' })));
  }
  for (const person of people) {
    for (const alias of person.aliases) {
      for (const other of byName.get(vocabularyKey(alias)) ?? []) {
        add(person, other, { kind: 'alias', alias });
      }
    }
  }
}

interface Address {
  readonly person: DuplicateCandidate;
  readonly written: string;
  readonly local: string;
  readonly domain: string;
}

/** Pairs by address: the same one, or two alike, compared within near domains only. */
function emailPairs(people: readonly DuplicateCandidate[], add: AddPair): void {
  const byDomain = new Map<string, Address[]>();
  for (const person of people) {
    for (const written of new Set(person.emails)) {
      const parts = addressParts(written);
      if (parts === null) continue;
      byDomain.set(parts.domain, [
        ...(byDomain.get(parts.domain) ?? []),
        { person, written, ...parts },
      ]);
    }
  }
  const domains = [...byDomain.keys()].sort();
  domains.forEach((domain, at) => {
    const here = byDomain.get(domain) ?? [];
    comparePairs(here, here, add);
    for (const other of domains.slice(at + 1)) {
      if (addressesMatch(`x@${domain}`, `x@${other}`) === null) continue;
      comparePairs(here, byDomain.get(other) ?? [], add);
    }
  });
}

/** Every pair of addresses between two groups (the same group: each pair once) that names one person. */
function comparePairs(left: readonly Address[], right: readonly Address[], add: AddPair): void {
  left.forEach((a, at) => {
    for (const b of left === right ? right.slice(at + 1) : right) {
      if (a.person.path === b.person.path) continue;
      if (a.local === b.local && a.domain === b.domain) {
        add(a.person, b.person, { kind: 'same-email', email: a.written });
        continue;
      }
      const match = addressesMatch(a.written, b.written);
      if (match === null) continue;
      const [first, second] = a.person.path < b.person.path ? [a, b] : [b, a];
      add(a.person, b.person, {
        kind: 'similar-email',
        left: first.written,
        right: second.written,
        ...match,
      });
    }
  });
}

/** The settings key the pairs said not to be one person are kept under, in `.atlas/settings.md`. */
export const NOT_DUPLICATE_PEOPLE_KEY = 'notDuplicatePeople';

/**
 * The pairs said not to be one person, as their keys: each a list of two
 * paths. Anything else under the key is not a pair, and is read as nothing.
 */
export function dismissedDuplicates(settings: Readonly<Record<string, unknown>>): Set<string> {
  const held = settings[NOT_DUPLICATE_PEOPLE_KEY];
  if (!Array.isArray(held)) return new Set();
  return new Set(
    held.flatMap((item: unknown) =>
      isPathPair(item) ? [duplicatePairKey(item[0] as VaultPath, item[1] as VaultPath)] : [],
    ),
  );
}

function isPathPair(item: unknown): item is readonly [string, string] {
  return (
    Array.isArray(item) &&
    item.length === 2 &&
    item.every((path) => typeof path === 'string' && path.trim() !== '') &&
    item[0] !== item[1]
  );
}

/**
 * The settings change that remembers one more pair as not one person: every
 * pair already remembered, then this one, each as its two paths in order.
 */
export function dismissDuplicateChanges(
  settings: Readonly<Record<string, unknown>>,
  pair: { left: VaultPath; right: VaultPath },
): Record<string, unknown> {
  const keys = dismissedDuplicates(settings);
  keys.add(duplicatePairKey(pair.left, pair.right));
  return { [NOT_DUPLICATE_PEOPLE_KEY]: [...keys].map((key) => key.split('\u0000')) };
}
