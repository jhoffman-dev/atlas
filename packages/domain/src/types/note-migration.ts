import { isDashboard } from '../dashboard/dashboard.ts';
import { isSavedView } from '../query/saved-view.ts';
import { isDatasource } from '../sources/datasource.ts';
import type { PropertyDef } from './property-def.ts';
import { validatePropertyValue } from './property-value.ts';

/**
 * Whether a note that says `type: x` holds values of type x. A saved view, a
 * dashboard and a source say it too, but there it names the notes they list or
 * make, and their keys are settings — a migration must never touch them.
 */
export function holdsTypeValues(frontmatter: Readonly<Record<string, unknown>>): boolean {
  return !isSavedView(frontmatter) && !isDatasource(frontmatter) && !isDashboard(frontmatter);
}

/**
 * A change to a type that the notes of that type can be brought along with.
 *
 * The type file is the definition, but the values live in each note, so a
 * renamed key or option leaves every note saying the old thing until it is
 * rewritten. Whether to rewrite is always the person's choice; this is what
 * rewriting would mean.
 */
export type NoteMigration =
  | { readonly kind: 'renameKey'; readonly from: string; readonly to: string }
  | { readonly kind: 'removeKey'; readonly key: string }
  | {
      readonly kind: 'renameOption';
      readonly key: string;
      readonly from: string;
      readonly to: string;
    };

type Properties = Readonly<Record<string, unknown>>;

const has = (properties: Properties, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(properties, key);

/**
 * The frontmatter changes that bring one note along, or null when the note
 * does not hold what changed — so a note is only written when it has to be.
 */
export function migrationChanges(
  migration: NoteMigration,
  properties: Properties,
): Properties | null {
  switch (migration.kind) {
    case 'renameKey':
      // A note that already has the new key keeps it: overwriting it with the
      // old key's value would lose what was there.
      if (!has(properties, migration.from) || has(properties, migration.to)) return null;
      return { [migration.from]: null, [migration.to]: properties[migration.from] };

    case 'removeKey':
      return has(properties, migration.key) ? { [migration.key]: null } : null;

    case 'renameOption':
      return renamedOption(migration, properties);
  }
}

function renamedOption(
  { key, from, to }: { key: string; from: string; to: string },
  properties: Properties,
): Properties | null {
  const value = properties[key];
  if (Array.isArray(value)) {
    if (!value.some((item) => String(item) === from)) return null;
    // Renamed where it stands, and not twice if the note already had the new one.
    const renamed = value.map((item) => (String(item) === from ? to : item));
    return { [key]: [...new Set(renamed)] };
  }
  return value !== undefined && value !== null && String(value) === from ? { [key]: to } : null;
}

/**
 * The values that will not fit a property once it has changed — a kind change
 * that turns text into a number, say. They are left in the notes, and shown as
 * problems there, so this is only a count to warn with before the change.
 */
export function valuesThatWontFit({
  def,
  values,
}: {
  def: PropertyDef;
  values: readonly unknown[];
}): number {
  // Required is about a missing value, which a kind change does not cause.
  const lenient = { ...def, required: false };
  return values.filter((value) => validatePropertyValue({ def: lenient, value }) !== null).length;
}
