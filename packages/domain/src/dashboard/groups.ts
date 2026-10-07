/**
 * The rules a chart of counted groups follows: what order the groups read in,
 * which one is called out, what share of the whole each is, and which are the
 * largest. Pure functions over `{ label, count }` — the charts only draw what
 * these decide.
 */

/** One value of a property and how many notes have it. The empty label is "no value". */
export interface GroupCount {
  readonly label: string;
  readonly count: number;
}

/**
 * Which group a chart calls out.
 *
 * - `last`: the last group in key order — the current phase, the latest month.
 * - `max`: the largest group; the first of equals.
 * - `none`: nothing is called out.
 * - `key`: that group, when it is there.
 */
export type GroupHighlight =
  | { readonly kind: 'last' }
  | { readonly kind: 'max' }
  | { readonly kind: 'none' }
  | { readonly kind: 'key'; readonly key: string };

/** Reads `highlight:` from a widget. Absent or blank means "the series' default". */
export function parseHighlight(value: unknown): GroupHighlight | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const declared = String(value).trim();
  if (declared === '') return null;
  if (declared === 'last' || declared === 'max' || declared === 'none') return { kind: declared };
  return { kind: 'key', key: declared };
}

/** A key that reads as a number — a phase, a year — sorts as one. */
export function isNumericKey(label: string): boolean {
  return label.trim() !== '' && Number.isFinite(Number(label));
}

/**
 * Key order: numbers numerically (2 before 10), everything else by its text
 * with any digits in it compared as numbers, and numbers before words.
 */
export function compareKeys(left: string, right: string): number {
  const leftNumeric = isNumericKey(left);
  const rightNumeric = isNumericKey(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right, 'en', { numeric: true });
}

export function sortByKey(groups: readonly GroupCount[]): GroupCount[] {
  return [...groups].sort((left, right) => compareKeys(left.label, right.label));
}

/**
 * Whether the groups are a series — every key a number — and so read in key
 * order rather than biggest first. Phases 0 to 16 are a series; statuses are not.
 */
export function isKeyedSeries(groups: readonly GroupCount[]): boolean {
  return groups.length > 0 && groups.every((group) => isNumericKey(group.label));
}

/**
 * The notes with no value, taken off the axis. "No value" is not a phase, and
 * as a bar it sat among the phases as if it were one.
 */
export function splitUnset(groups: readonly GroupCount[]): {
  readonly groups: GroupCount[];
  readonly unset: number;
} {
  const unset = groups
    .filter((group) => group.label === '')
    .reduce((sum, group) => sum + group.count, 0);
  return { groups: groups.filter((group) => group.label !== ''), unset };
}

/** A series reads in key order; anything else as it came, which is biggest first. */
export function orderForAxis(groups: readonly GroupCount[]): GroupCount[] {
  return isKeyedSeries(groups) ? sortByKey(groups) : [...groups];
}

/**
 * The label of the group `rule` calls out, or null. With no rule, a series
 * calls out its last key — where the work is now — and anything else its
 * largest group.
 */
export function highlightedKey(
  groups: readonly GroupCount[],
  rule: GroupHighlight | null,
): string | null {
  const chosen = rule ?? (isKeyedSeries(groups) ? { kind: 'last' } : { kind: 'max' });
  switch (chosen.kind) {
    case 'none':
      return null;
    case 'last':
      return sortByKey(groups).at(-1)?.label ?? null;
    case 'max':
      return largestGroup(groups)?.label ?? null;
    case 'key':
      return groups.some((group) => group.label === chosen.key) ? chosen.key : null;
  }
}

function largestGroup(groups: readonly GroupCount[]): GroupCount | null {
  let largest: GroupCount | null = null;
  for (const group of groups) if (largest === null || group.count > largest.count) largest = group;
  return largest;
}

/**
 * Whole-number percentages that add up to exactly 100, by largest remainder:
 * each share is rounded down, and the points left over go to the shares that
 * lost the most in rounding. Plain rounding gives 33 + 33 + 33 = 99.
 */
export function sharesOf(counts: readonly number[]): number[] {
  const safe = counts.map((count) => (Number.isFinite(count) && count > 0 ? count : 0));
  const total = safe.reduce((sum, count) => sum + count, 0);
  if (total === 0) return safe.map(() => 0);

  const exact = safe.map((count) => (count / total) * 100);
  const shares = exact.map(Math.floor);
  const leftOver = 100 - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const { index } of byRemainder.slice(0, leftOver)) shares[index] = (shares[index] ?? 0) + 1;
  return shares;
}

/** One row of a ranking: its group, and its size beside the largest (0 to 1). */
export interface RankedGroup extends GroupCount {
  readonly fraction: number;
}

/**
 * The `top` largest groups, largest first, ties in key order. `shown` is how
 * many notes those rows hold and `total` how many the chart counted, so the
 * ranking can say how much of the whole it covers.
 */
export function rankGroups(
  groups: readonly GroupCount[],
  top: number,
): { readonly rows: RankedGroup[]; readonly shown: number; readonly total: number } {
  const ranked = [...groups]
    .filter((group) => group.count > 0)
    .sort((left, right) => right.count - left.count || compareKeys(left.label, right.label))
    .slice(0, Math.max(0, top));
  const largest = ranked[0]?.count ?? 0;

  return {
    rows: ranked.map((group) => ({ ...group, fraction: largest > 0 ? group.count / largest : 0 })),
    shown: ranked.reduce((sum, group) => sum + group.count, 0),
    total: groups.reduce((sum, group) => sum + group.count, 0),
  };
}

/**
 * Every declared option of a select, the ones no note has yet counted as zero,
 * after the counted ones. A legend that leaves out "review" because nothing is
 * in review hides that the stage exists.
 *
 * `counted` is every group the notes were counted into, before any were
 * gathered into Other: an option folded into Other has notes, and listing it
 * again as zero would say its stage is empty.
 */
export function withEmptyOptions(
  groups: readonly GroupCount[],
  options: readonly string[],
  counted: readonly GroupCount[] = groups,
): GroupCount[] {
  const present = new Set([...groups, ...counted].map((group) => group.label));
  const missing = options.filter((option) => !present.has(option));
  return [...groups, ...missing.map((label) => ({ label, count: 0 }))];
}

/**
 * The first `max` groups, with the rest gathered into one "Other" group. Past
 * a handful, slices stop answering anything and become slivers.
 *
 * The gathered group is named so it never shares a label with a real group or
 * with any of `reserved` (the options a legend may list beside it): "Other",
 * or "Other (3 more)" when a real option is already called Other.
 */
export function gatherTail(
  groups: readonly GroupCount[],
  max: number,
  reserved: readonly string[] = [],
): GroupCount[] {
  const counted = groups.filter((group) => group.count > 0);
  if (counted.length <= max) return [...groups];
  const gathered = counted.slice(max);
  const rest = gathered.reduce((sum, group) => sum + group.count, 0);
  const taken = new Set([...groups.map((group) => group.label), ...reserved]);
  return [...counted.slice(0, max), { label: tailLabel(taken, gathered.length), count: rest }];
}

export const OTHER_LABEL = 'Other';

/** "Other", unless a real group has it; then "Other (N more)", numbered on if even that is taken. */
function tailLabel(taken: ReadonlySet<string>, gathered: number): string {
  if (!taken.has(OTHER_LABEL)) return OTHER_LABEL;
  const more = `${OTHER_LABEL} (${gathered} more)`;
  let label = more;
  for (let copy = 2; taken.has(label); copy += 1) label = `${more} ${copy}`;
  return label;
}
