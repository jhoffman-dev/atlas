/**
 * Reading a query out of a note's frontmatter.
 *
 * Shared by saved views and dashboard widgets, which ask the same questions and
 * differ only in how they draw the answer. Anything unreadable is dropped rather
 * than rejected: a mistyped filter should cost you the filter, not the table.
 */

import {
  DEFAULT_QUERY_LIMIT,
  FILTER_OPERATORS,
  type FilterOperator,
  type QueryFilter,
  type QuerySort,
  type ViewQuery,
} from './view-query.ts';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A repeat is dropped, as a type's options are: a view's columns are keyed by
// name, and a hand-edited view file can list one twice.
export function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter((item) => item !== ''))];
}

export function asFilters(value: unknown): QueryFilter[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const key = String(item['key'] ?? '').trim();
    const operator = String(item['operator'] ?? '') as FilterOperator;
    if (key === '' || !FILTER_OPERATORS.includes(operator)) return [];

    const raw = item['value'];
    const usable =
      typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : null;
    return [{ key, operator, ...(usable === null ? {} : { value: usable }) }];
  });
}

export function asSorts(value: unknown): QuerySort[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const key = String(item['key'] ?? '').trim();
    if (key === '') return [];
    return [{ key, direction: item['direction'] === 'desc' ? 'desc' : 'asc' }];
  });
}

export function asLimit(value: unknown): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_QUERY_LIMIT;
}

/** The query part of a view or a widget: what to ask, not how to draw it. */
export function asQuery(source: Readonly<Record<string, unknown>>): ViewQuery | null {
  const type = String(source['type'] ?? '').trim();
  if (type === '') return null;

  return {
    type,
    columns: asStrings(source['columns']),
    filters: asFilters(source['filters']),
    sorts: asSorts(source['sorts']),
    limit: asLimit(source['limit']),
  };
}

/**
 * A blank string reads as "not set", which is what an absent key means too —
 * and so does a list or a map: a name is one word, and `[area, phase]` read as
 * the text "area,phase" would name nothing and stop the whole view running.
 */
export function asName(value: unknown): string | null {
  if (typeof value === 'object' && value !== null) return null;
  const name = String(value ?? '').trim();
  return name === '' ? null : name;
}
