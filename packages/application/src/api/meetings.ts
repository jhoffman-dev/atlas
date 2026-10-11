import {
  compileMeetingListQuery,
  importStanding,
  isArchivedPath,
  MEETING_LIST_LIMIT,
  MeetingMappingError,
  readEventTime,
  type MeetingFields,
} from '@atlas/domain';
import { MeetingPathsTakenError, receiveMeeting, type MeetingReceipt } from '../meetings/index.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import type { ApiMeeting } from './contract.ts';
import {
  bodyObject,
  countOf,
  isRecord,
  offsetOf,
  optionalArray,
  optionalString,
  queryFlag,
  requiredText,
  type Fields,
} from './fields.ts';
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
    importOutcome: importStanding({ path, stamped: Boolean(row[11]), stamp: row[8] }),
    importError: text(9),
    duplicateOf: text(10),
  };
  return isArchivedPath(path) ? { ...meeting, archived: true } : meeting;
}

const textOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/**
 * Takes in a meeting another program sends — n8n, in James's setup (#93) —
 * mapped by the rules its workflow's Code nodes run, and written into
 * `Inbox/Meetings/`, where the import settles it as any arrival. The same
 * provider and id already held is answered 200 `in-vault`, and nothing is
 * written; a new file is 201 `written`. A meeting the mapping cannot place in
 * time, or whose file the contract would refuse, is `invalid`, with why.
 */
export async function receiveMeetingRoute(request: VaultRequest): Promise<RouteResult> {
  const body = bodyObject(request.body);
  const fields = meetingFieldsOf(body);
  const timeZone = optionalString(body, 'timeZone') ?? request.timeZone;
  const receipt = await receiveMeeting({ ports: request, fields, options: { timeZone } }).catch(
    refusedMeeting,
  );
  // A meeting found held is only held in the vault the request was for.
  request.assertStillOpen();
  return { status: receipt.outcome === 'written' ? 201 : 200, body: { meeting: receipt } };
}

/** The request as the mapper's fields: the names n8n's "Meeting fields for Atlas" node gives them. */
function meetingFieldsOf(body: Fields): MeetingFields {
  return {
    source: requiredText(body, 'provider'),
    sourceId: requiredText(body, 'sourceId'),
    title: requiredText(body, 'title'),
    stated: optionalString(body, 'subject'),
    arrived: optionalString(body, 'arrived'),
    attendees: attendeesOf(body),
    sections: optionalString(body, 'summaryMd'),
    transcript: optionalString(body, 'transcriptMd'),
    category: optionalString(body, 'category'),
  };
}

/** Each attendee as `{ name, email }`, either text or left out. */
function attendeesOf(body: Fields): readonly Fields[] | undefined {
  return optionalArray(body, 'attendees')?.map((attendee, at) => {
    if (!isRecord(attendee)) throw new ApiError('invalid', `attendees[${at}] must be an object`);
    for (const key of ['name', 'email']) {
      const value = attendee[key];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new ApiError('invalid', `attendees[${at}].${key} must be a string`);
      }
    }
    return { name: attendee['name'], email: attendee['email'] };
  });
}

/** Why a meeting was not taken, as the caller is told it. */
function refusedMeeting(error: unknown): MeetingReceipt {
  if (error instanceof MeetingMappingError) throw new ApiError('invalid', error.message);
  if (error instanceof MeetingPathsTakenError) throw new ApiError('exists', error.message);
  throw error;
}
