/**
 * What a type and a property may be called.
 *
 * Both names end up inside SQL: each type is a view (`v_<name>`) and each of its
 * properties a column of it, and a name the index cannot quote is silently left
 * out of the view. So both follow the index's rule — a letter or `_`, then
 * letters, digits and `_` — and the words a person types are turned into one.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Type names that already mean something else in a vault. `type:` on a view,
 * a dashboard or a source names the notes it lists, and the others are what
 * Atlas calls its own files; a type called any of them would be confused with
 * the thing it names.
 */
const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
  'atlas',
  'view',
  'dashboard',
  'source',
  'datasource',
  'template',
  'type',
]);

/** The columns every type's view has before any property of its own. */
const VIEW_COLUMNS: ReadonlySet<string> = new Set(['path', 'title', 'summary', 'modified']);

/**
 * Whether a property's key names one of a view's own columns. SQLite reads
 * column names without regard to case, so neither may `Modified`.
 */
export const isViewColumn = (key: string): boolean => VIEW_COLUMNS.has(key.toLowerCase());

/**
 * Property keys every type's view already has, or that say which type a note
 * is. A property called one would collide with a column the index adds itself.
 */
const RESERVED_PROPERTY_KEYS: ReadonlySet<string> = new Set(['type', ...VIEW_COLUMNS]);

/**
 * Words as a name: `Book club` is `book_club`, `Café` is `cafe`. Empty when
 * nothing usable is left; a leading digit gets an underscore in front, since a
 * name may not start with one.
 */
export function slugifyName(words: string): string {
  const slug = words
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(slug) ? `_${slug}` : slug;
}

/** Why a new type cannot be called `name`, or null when it can. */
export function typeNameProblem({
  name,
  existing,
}: {
  name: string;
  /** The names the vault's types already have. */
  existing: readonly string[];
}): string | null {
  if (name.trim() === '') return 'A type needs a name';
  if (!IDENTIFIER.test(name)) {
    return `"${name}" can only hold letters, digits and _, and cannot start with a digit`;
  }
  if (RESERVED_TYPE_NAMES.has(name.toLowerCase())) {
    return `"${name}" is a name Atlas uses itself; choose another`;
  }
  if (existing.some((taken) => taken.toLowerCase() === name.toLowerCase())) {
    return `There is already a type called "${name}"`;
  }
  return null;
}

/** Why a property cannot be stored under `key`, or null when it can. */
export function propertyKeyProblem({
  key,
  existing,
}: {
  key: string;
  /** The keys the type's other properties have. */
  existing: readonly string[];
}): string | null {
  if (key.trim() === '') return 'A property needs a name';
  if (!IDENTIFIER.test(key)) {
    return `"${key}" can only hold letters, digits and _, and cannot start with a digit`;
  }
  if (RESERVED_PROPERTY_KEYS.has(key.toLowerCase())) {
    return `"${key}" is a name every note already has; choose another`;
  }
  if (existing.some((taken) => taken.toLowerCase() === key.toLowerCase())) {
    return `There is already a property called "${key}"`;
  }
  return null;
}

/**
 * A key made from `words` that none of `existing` has taken: `status`, then
 * `status_2`, and so on. For a property added with a default name, which should
 * never fail for being the second one.
 */
export function freePropertyKey({
  words,
  existing,
}: {
  words: string;
  existing: readonly string[];
}): string {
  const base = slugifyName(words) || 'property';
  const taken = (key: string) => propertyKeyProblem({ key, existing }) !== null;
  if (!taken(base)) return base;
  let suffix = 2;
  while (taken(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
