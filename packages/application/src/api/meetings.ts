import {
  compileMeetingListQuery,
  IMPORT_OUTCOME_KEY,
  importOutcomeOf,
  isArchivedPath,
  MEETING_LIST_LIMIT,
  readEventTime,
} from '@atlas/domain';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import type { ApiMeeting } from './contract.ts';
import { countOf, offsetOf, queryFlag } from './fields.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

const LISTED = { fallback: 50, max: MEETING_LIST_LIMIT };

/**
 * The vault's meetings, newest first, a page at a time (P28-04): every note
 * of the Meeting type, and every meeting file that failed import, with the
 * error the import wrote into it. `since` keeps the ones on or after a day.
 * A duplicate is archived, so it is listed only with `includeArchived`.
 */
export async function meetingsRoute(request: VaultRequest): Promise<RouteResult> {
  const since = sinceOf(request.query['since']);
  const limit = countOf(request.query['limit'], { field: 'limit', ...LISTED });
  const offset = offsetOf(request.query['offset']);
  const includeArchived = queryFlag(request.query['includeArchived'], 'includeArchived');
  // One more than asked for says whether there is another page.
  const { sql, parameters } = compileMeetingListQuery({
    since,
    includeArchived,
    limit: limit + 1,
    offset,
  });
  const found = await request.index.query(sql, parameters).catch((error: unknown) => {
    throw new ApiError(
      'query_failed',
      `The index could not list meetings: ${messageWithoutPaths(error)}`,
    );
  });
  const truncated = found.rows.length > limit;
  const meetings = found.rows.slice(0, limit).map(toApiMeeting);
  return {
    status: 200,
    body: { meetings, truncated, next: truncated ? offset + meetings.length : null },
  };
}

function sinceOf(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const read = readEventTime(raw);
  if (read === null || read.minutes !== null || read.date !== raw) {
    throw new ApiError('invalid', 'since must be a real day, written YYYY-MM-DD');
  }
  return raw;
}

/** A row of the list, in `MEETING_LIST_COLUMNS` order, as the API answers it. */
function toApiMeeting(row: readonly unknown[]): ApiMeeting {
  const text = (column: number): string | null => textOrNull(row[column]);
  const path = text(0) ?? '';
  const meeting: ApiMeeting = {
    path,
    title: text(1) ?? '',
    date: text(2),
    start: text(3),
    end: text(4),
    kind: text(5),
    provider: text(6),
    externalId: text(7),
    importOutcome: outcomeOf(text(8)),
    importError: text(9),
    duplicateOf: text(10),
  };
  return isArchivedPath(path) ? { ...meeting, archived: true } : meeting;
}

/** The import's stamp as the API says it: one it does not know is a file let in, as the import reads it. */
function outcomeOf(stamp: string | null): ApiMeeting['importOutcome'] {
  return stamp === null ? null : importOutcomeOf({ [IMPORT_OUTCOME_KEY]: stamp });
}

const textOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
