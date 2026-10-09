import type { ObjectType } from '../types/property-def.ts';

/** What a note's checklist progress is called in a view's columns and in a query (P30-03). */
export const PROGRESS_FIELD = 'progress';

/**
 * Whether a type's notes are read with their checklist progress. A type that
 * declares a property of that name keeps its own: the vault's word for it
 * wins over the one Atlas works out. SQLite reads column names regardless of
 * case, so `Progress` is that name too.
 */
export function carriesChecklistProgress(type: Pick<ObjectType, 'properties'>): boolean {
  return !type.properties.some((property) => property.key.toLowerCase() === PROGRESS_FIELD);
}

/** The column a type's view holds each note's checklist progress in, or null when it holds none. */
export function checklistProgressKey(type: Pick<ObjectType, 'properties'> | null): string | null {
  return type !== null && carriesChecklistProgress(type) ? PROGRESS_FIELD : null;
}

/**
 * A view row's checklist progress, to draw as a bar: its number, when the
 * row's type has no `progress` of its own (its declared `kinds` say); else
 * null, as for a note with no box.
 */
export function rowChecklistProgress({
  values,
  kinds,
}: {
  values: Readonly<Record<string, unknown>>;
  kinds: Readonly<Record<string, unknown>>;
}): number | null {
  if (Object.keys(kinds).some((key) => key.toLowerCase() === PROGRESS_FIELD)) return null;
  const value = values[PROGRESS_FIELD];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
