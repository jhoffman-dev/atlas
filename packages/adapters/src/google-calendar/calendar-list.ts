import type { GoogleCalendar } from '@atlas/domain';

/** One page of the Calendar API's `calendarList`, as Atlas reads it. */
export interface CalendarListPage {
  readonly calendars: readonly GoogleCalendar[];
  /** The `pageToken` for the next page; null on the last. */
  readonly next: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A calendar from the API's wire form: `id`, `summary`, `primary` and
 * `accessRole`. An entry without an id or a name is left out rather than
 * guessed at; one shared with the person is not `owner`.
 */
export function calendarOf(entry: unknown): GoogleCalendar | null {
  if (!isRecord(entry)) return null;
  const { id, summary, primary, accessRole } = entry;
  if (typeof id !== 'string' || id === '' || typeof summary !== 'string') return null;
  return { id, name: summary, primary: primary === true, owned: accessRole === 'owner' };
}

/**
 * A `calendarList` page. A calendar Atlas has just made, or one `calendars`
 * answered with, has no `accessRole`: it is the person's own.
 */
export function calendarListPage(body: unknown): CalendarListPage | null {
  if (!isRecord(body)) return null;
  const items = Array.isArray(body.items) ? body.items : [];
  const next = typeof body.nextPageToken === 'string' ? body.nextPageToken : null;
  return {
    calendars: items.map(calendarOf).filter((entry) => entry !== null),
    next,
  };
}

/** The calendar `POST /calendars` answers with: made by Atlas, so the person's own. */
export function createdCalendarOf(body: unknown): GoogleCalendar | null {
  const made = calendarOf(isRecord(body) ? { ...body, accessRole: 'owner' } : body);
  return made === null ? null : { ...made, primary: false };
}
