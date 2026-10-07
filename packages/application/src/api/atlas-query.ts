import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT } from '@atlas/domain';
import { ApiError } from './api-error.ts';
import { answerAtlasQueryPage, groupsOf } from './atlas-query-answer.ts';
import type { ApiAtlasQueryRows } from './contract.ts';
import { bodyObject, countOf, requiredText, type Fields } from './fields.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * The longest query text taken, in characters. A query holds 2000 conditions
 * at most (the checker's cap); this leaves room for that many and keeps
 * parsing cheap.
 */
export const MAX_QUERY_TEXT = 200_000;

/**
 * Runs an Atlas query (ADR-0019) as the query builder runs it, read-only:
 * the rows, and — for `GROUP BY` — the groups and sub-groups a list shows.
 * Archived notes are left out unless the text says `INCLUDE ARCHIVED`; the
 * text is the only place that says so.
 */
export async function atlasQueryRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const { answer, rows } = await answerAtlasQueryPage(
    request,
    queryTextOf(fields),
    askedLimitOf(fields),
  );
  const groups =
    answer.compiled.groups.length > 0 ? await groupsOf(request, answer.compiled, rows) : null;
  // The index belongs to whichever vault is open now: an answer read after a
  // switch would be the other vault's rows.
  request.assertStillOpen();
  const body: ApiAtlasQueryRows = { ...rows, ...(groups !== null && { groups }) };
  return { status: 200, body };
}

function queryTextOf(fields: Fields): string {
  if (fields['includeArchived'] !== undefined) {
    throw new ApiError(
      'invalid',
      'includeArchived is not taken here: write INCLUDE ARCHIVED in the query',
    );
  }
  const text = requiredText(fields, 'query');
  if (isLongerThan(text, MAX_QUERY_TEXT)) {
    throw new ApiError('invalid', `query must be at most ${MAX_QUERY_TEXT} characters`);
  }
  return text;
}

/**
 * Whether a text holds more than `most` characters, as a person counts them:
 * an emoji is one character, though it is two UTF-16 units.
 */
function isLongerThan(text: string, most: number): boolean {
  // A text's characters are never more than its units, so most texts stop here.
  return text.length > most && [...text].length > most;
}

function askedLimitOf(fields: Fields): number | null {
  const raw = fields['limit'];
  if (raw === undefined) return null;
  return countOf(raw, { field: 'limit', fallback: DEFAULT_QUERY_LIMIT, max: MAX_QUERY_LIMIT });
}
