import type { ObjectType } from '../types/property-def.ts';
import { DEFAULT_QUERY_LIMIT, type ViewQuery } from './view-query.ts';

/**
 * Every note of a type, as a query.
 *
 * This is what a type in the sidebar opens: the notes themselves, in a table
 * whose columns are the properties the type declares. It is built rather than
 * saved, so it cannot drift from the definition — adding a property to a type
 * adds the column, and nothing has to be kept in step.
 *
 * Sorted by title, because nothing else about a type says what order its notes
 * should be in, and a table that reorders itself between visits is worse than
 * one that is merely alphabetical.
 */
export function typeTableQuery(type: ObjectType): ViewQuery {
  return {
    type: type.name,
    columns: type.properties.map((property) => property.key),
    filters: [],
    sorts: [{ key: 'title', direction: 'asc' }],
    limit: DEFAULT_QUERY_LIMIT,
  };
}
