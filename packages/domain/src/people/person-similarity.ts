import { emailDomain, isPublicMail } from '../meeting-links/attendee-matching.ts';

/**
 * How alike two people's addresses are, for the possible-duplicates list
 * (#464). Each rule is a threshold the list is held to, named here so a test
 * can say which one a pair met or missed.
 */

/** A local part this long or longer, compacted, may differ by one letter (`marraquill`). */
export const LOCAL_ONE_EDIT_FROM = 5;
/** A local part this long or longer, compacted, may differ by two (`tobiasfeen` for `tobiasfenn`). */
export const LOCAL_TWO_EDITS_FROM = 10;
/** A domain this long or longer may differ by one letter (`larkspor.example.com`). */
export const DOMAIN_ONE_EDIT_FROM = 8;
/** A domain this long or longer may differ by two. */
export const DOMAIN_TWO_EDITS_FROM = 14;

/** What separates the words of a local part: `mara.quill`, `mara_quill`, `mara-quill`. */
const SEPARATORS = /[._-]+/u;

/** An address split as it is compared: its local part and its domain, both folded; null when it is not one. */
export interface AddressParts {
  readonly local: string;
  readonly domain: string;
}

/**
 * An address as compared: the part in `<…>` when written as a mail client
 * copies it, composed, case folded, and a `+tag` dropped from the local part
 * (`mara+payroll@` is `mara@`). Null for text with no `@` or nothing either side.
 */
export function addressParts(written: string): AddressParts | null {
  const bracketed = /<([^<>]+)>\s*$/u.exec(written)?.[1] ?? written;
  const address = bracketed.normalize('NFC').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0) return null;
  const local = (address.slice(0, at).split('+')[0] ?? '').trim();
  const domain = emailDomain(address) ?? '';
  return local === '' || domain === '' ? null : { local, domain };
}

/**
 * The fewest single-letter changes — a letter added, dropped, changed, or two
 * neighbours swapped — that turn `left` into `right`, or null when it is more
 * than `most`. Compared by code point, so an accented letter is one letter.
 */
export function editDistanceWithin(left: string, right: string, most: number): number | null {
  const a = [...left];
  const b = [...right];
  if (Math.abs(a.length - b.length) > most) return null;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      const swapped = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
      if (swapped) best = Math.min(best, (before[j - 2] ?? 0) + 1);
      row.push(best);
    }
    if (Math.min(...row) > most) return null;
    before = previous;
    previous = row;
  }
  const distance = previous[b.length] ?? 0;
  return distance <= most ? distance : null;
}

/** How many edits two strings this long may be apart and still count as one. */
function allowedEdits(shorter: number, one: number, two: number): number {
  if (shorter >= two) return 2;
  return shorter >= one ? 1 : 0;
}

/** Whether two words are within the edits their length allows. */
function near(left: string, right: string, one: number, two: number): boolean {
  if (left === right) return true;
  const most = allowedEdits(Math.min([...left].length, [...right].length), one, two);
  return most > 0 && editDistanceWithin(left, right, most) !== null;
}

/** Whether two domains are one, or a small typo apart (`larkspur.example.com`, `larkspor.example.com`). */
export function domainsNear(left: string, right: string): boolean {
  return near(left, right, DOMAIN_ONE_EDIT_FROM, DOMAIN_TWO_EDITS_FROM);
}

/** How two local parts were found alike, for the reason a pair shows. */
export type LocalMatch = 'same' | 'first-name' | 'typo';

/**
 * Whether two local parts name the same person, and how:
 *
 * - `same` — equal once their separators are dropped (`mara.quill`, `maraquill`, `mara_quill`);
 * - `first-name` — one is the first word of the other (`mara`, `mara.quill`) — not at a
 *   public mail provider, where `mara@` is anyone called Mara;
 * - `typo` — the compacted forms a letter or two apart, by length (`marra.quill`).
 */
export function localPartsMatch(
  left: string,
  right: string,
  { publicMail }: { publicMail: boolean },
): LocalMatch | null {
  const leftWords = left.split(SEPARATORS).filter((word) => word !== '');
  const rightWords = right.split(SEPARATORS).filter((word) => word !== '');
  const leftCompact = leftWords.join('');
  const rightCompact = rightWords.join('');
  if (leftCompact === '' || rightCompact === '') return null;
  if (leftCompact === rightCompact) return 'same';
  if (!publicMail && isFirstWordOf(leftWords, rightWords)) return 'first-name';
  if (near(leftCompact, rightCompact, LOCAL_ONE_EDIT_FROM, LOCAL_TWO_EDITS_FROM)) return 'typo';
  return null;
}

/** Whether one local part is a single word that is the other's first, of two or more. */
function isFirstWordOf(left: readonly string[], right: readonly string[]): boolean {
  const [one, many] = left.length === 1 ? [left, right] : [right, left];
  return one.length === 1 && many.length >= 2 && one[0] === many[0];
}

/** Two addresses found alike: how their local parts matched, and whether their domains were the same. */
export interface AddressMatch {
  readonly local: LocalMatch;
  readonly sameDomain: boolean;
}

/**
 * Whether two addresses are likely one person's: their domains the same or a
 * typo apart, and their local parts matching ({@link localPartsMatch}).
 * Addresses at unrelated domains are never matched: `mara.quill@` at two
 * companies may be two people, and the list would fill with them.
 */
export function addressesMatch(left: string, right: string): AddressMatch | null {
  const a = addressParts(left);
  const b = addressParts(right);
  if (a === null || b === null) return null;
  if (a.local === b.local && a.domain === b.domain) return null;
  if (!domainsNear(a.domain, b.domain)) return null;
  const publicMail = isPublicMail(a.domain) || isPublicMail(b.domain);
  const local = localPartsMatch(a.local, b.local, { publicMail });
  return local === null ? null : { local, sameDomain: a.domain === b.domain };
}
