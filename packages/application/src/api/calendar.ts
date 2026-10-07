import {
  AGENDA_DAYS,
  asCalendarRange,
  CALENDAR_RANGES,
  calendarEndKey,
  calendarEvents,
  eventsInDays,
  isSavedView,
  isTimed,
  parseSavedView,
  parseSqlView,
  parseViewDisplay,
  queryForLayout,
  rangeDays,
  readEventTime,
  slotValue,
  splitFrontmatter,
  toBoardRows,
  type CalendarRange,
  type EventInRange,
  type EventTime,
  type ViewQuery,
} from '@atlas/domain';
import { ApiError } from './api-error.ts';
import type { ApiCalendar, ApiCalendarEvent } from './contract.ts';
import { bodyObject, countOf, optionalString, type Fields } from './fields.ts';
import { readNote } from './note-io.ts';
import { isApiViewPath, viewPathFromUrl } from './paths.ts';
import { runViewQuery } from './query.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';
import { spelledAsVault } from './vault-spelling.ts';

/** The longest agenda a request may ask for: a year, as the calendar draws a note across. */
const MAX_AGENDA_DAYS = 366;

/**
 * A saved view's notes on a calendar, as its month, week, 3-day, day or
 * agenda range shows them: the range's days — a week from its Monday, a month
 * as its grid of six weeks — and each note on any of them, placed by the
 * view's date and, when its timeline ends on another, spanned to that end.
 */
export async function calendarRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const path = await spelledAsVault({
    fs: request.fs,
    asked: viewPathFromUrl(request.pathParam),
    accepts: isApiViewPath,
  });
  const { text } = await readNote(request, path);
  const properties = request.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  const { query, dateKey, endKey, savedRange } = calendarOf(path, properties);

  const range = rangeOf(fields, savedRange);
  const length = daysOf(fields, range);
  const days = rangeDays({
    range,
    anchor: anchorOf(fields, request),
    ...(length !== undefined && { days: length }),
  });
  const run = await runViewQuery(request, withDates(query, { dateKey, endKey }));
  const { events, unscheduled } = calendarEvents({ rows: toBoardRows(run), dateKey, endKey });

  const calendar: ApiCalendar = {
    range,
    days,
    events: eventsInDays({ events, days }).map(toApiEvent),
    unscheduled,
    truncated: run.truncated,
  };
  return { status: 200, body: calendar };
}

/** The view's query and the dates it places notes by; refused for a view with no date. */
function calendarOf(path: string, properties: Fields) {
  if (!isSavedView(properties)) throw new ApiError('not_found', `${path} is not a view`);
  if (parseSqlView(properties) !== null) {
    throw new ApiError('invalid', `${path} is a SQL view, which has no calendar`);
  }
  const query = parseSavedView(properties);
  if (query === null) throw new ApiError('invalid', `${path} does not say which type it lists`);
  const display = parseViewDisplay(properties);
  if (display.dateKey === null) {
    throw new ApiError('invalid', `${path} names no date to place its notes on (dateKey)`);
  }
  const { dateKey, startKey } = display;
  return {
    query,
    dateKey,
    endKey: calendarEndKey({ dateKey, startKey, endKey: display.endKey }),
    savedRange: display.calendarRange,
  };
}

/** The query as a calendar runs it, with its date and end among the columns whatever it shows. */
function withDates(
  query: ViewQuery,
  { dateKey, endKey }: { dateKey: string; endKey: string | null },
): ViewQuery {
  const dated = query.columns.includes(dateKey)
    ? query
    : { ...query, columns: [...query.columns, dateKey] };
  return queryForLayout({ query: dated, layout: 'calendar', statusKey: null, endKey }).query;
}

function rangeOf(fields: Fields, saved: CalendarRange): CalendarRange {
  const asked = optionalString(fields, 'range');
  if (asked === undefined) return saved;
  if (!CALENDAR_RANGES.includes(asked as CalendarRange)) {
    throw new ApiError('invalid', `range must be one of ${CALENDAR_RANGES.join(', ')}`);
  }
  return asCalendarRange(asked);
}

function anchorOf(fields: Fields, request: VaultRequest): string {
  const anchor = optionalString(fields, 'anchor');
  if (anchor === undefined) return request.clock.today();
  const read = readEventTime(anchor);
  if (read === null || read.minutes !== null || read.date !== anchor) {
    throw new ApiError('invalid', 'anchor must be a real day, written YYYY-MM-DD');
  }
  return anchor;
}

function daysOf(fields: Fields, range: CalendarRange): number | undefined {
  if (fields['days'] === undefined) return undefined;
  if (range !== 'agenda') throw new ApiError('invalid', 'days is for an agenda only');
  return countOf(fields['days'], { field: 'days', fallback: AGENDA_DAYS, max: MAX_AGENDA_DAYS });
}

function toApiEvent({ event, on }: EventInRange): ApiCalendarEvent {
  return {
    path: event.path,
    title: event.title,
    start: written(event.start),
    end: event.end === null ? null : written(event.end),
    allDay: !isTimed(event),
    on,
  };
}

function written(time: EventTime): string {
  return slotValue(time.date, time.minutes);
}
