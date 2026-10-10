import { describe, expect, it } from 'vitest';
import {
  canHoldBlocks,
  dedicatedCalendar,
  needsBlocksCalendar,
  parseGoogleCalendarSetting,
  parseGoogleClientId,
  GOOGLE_CALENDAR_SCOPES,
  type GoogleCalendar,
} from './google-calendar.ts';

const CLIENT_ID = '123456789012-abcdef0123456789abcdef0123456789.apps.googleusercontent.com';

const calendar = (overrides: Partial<GoogleCalendar> = {}): GoogleCalendar => ({
  id: 'atlas-blocks@group.calendar.example.com',
  name: 'Atlas blocks',
  primary: false,
  owned: true,
  ...overrides,
});

describe('GOOGLE_CALENDAR_SCOPES', () => {
  it('asks only for the calendars Atlas makes itself', () => {
    expect(GOOGLE_CALENDAR_SCOPES).toEqual([
      'https://www.googleapis.com/auth/calendar.app.created',
    ]);
  });
});

describe('parseGoogleClientId', () => {
  it('takes a client ID as Google issues it, trimmed', () => {
    expect(parseGoogleClientId(`  ${CLIENT_ID}\n`)).toBe(CLIENT_ID);
  });

  it('refuses anything else', () => {
    for (const raw of [
      '',
      'abc',
      CLIENT_ID.replace('.apps.googleusercontent.com', '.example.com'),
      `x${CLIENT_ID}`,
      `${CLIENT_ID} extra`,
      'GOCSPX-a-client-secret',
      123,
      null,
    ]) {
      expect(parseGoogleClientId(raw), String(raw)).toBeNull();
    }
  });
});

describe('canHoldBlocks', () => {
  it('is a calendar the person owns that is not their main one', () => {
    expect(canHoldBlocks(calendar())).toBe(true);
    expect(canHoldBlocks(calendar({ primary: true }))).toBe(false);
    expect(canHoldBlocks(calendar({ owned: false }))).toBe(false);
  });
});

describe('dedicatedCalendar', () => {
  const calendars = [
    calendar({ id: 'mara@example.com', name: 'Mara Quill', primary: true }),
    calendar(),
    calendar({ id: 'shared@example.com', name: 'Team', owned: false }),
  ];

  it('is the chosen calendar while it is listed', () => {
    expect(dedicatedCalendar(calendars, 'atlas-blocks@group.calendar.example.com')).toEqual(
      calendar(),
    );
  });

  it('is none when nothing is chosen, the choice is gone, or it may not hold blocks', () => {
    expect(dedicatedCalendar(calendars, null)).toBeNull();
    expect(dedicatedCalendar(calendars, 'gone@example.com')).toBeNull();
    expect(dedicatedCalendar(calendars, 'mara@example.com')).toBeNull();
    expect(dedicatedCalendar(calendars, 'shared@example.com')).toBeNull();
  });
});

describe('needsBlocksCalendar', () => {
  it('offers to make the calendar until one with its name can hold blocks', () => {
    expect(needsBlocksCalendar([])).toBe(true);
    expect(needsBlocksCalendar([calendar({ name: 'Other' })])).toBe(true);
    expect(needsBlocksCalendar([calendar({ owned: false })])).toBe(true);
    expect(needsBlocksCalendar([calendar({ name: 'Other' }), calendar()])).toBe(false);
  });
});

describe('parseGoogleCalendarSetting', () => {
  it('reads the client ID and the chosen calendar', () => {
    expect(
      parseGoogleCalendarSetting({
        google_client_id: CLIENT_ID,
        google_calendar: ' atlas-blocks@group.calendar.example.com ',
      }),
    ).toEqual({ clientId: CLIENT_ID, calendarId: 'atlas-blocks@group.calendar.example.com' });
  });

  it('treats anything unusable as unset', () => {
    expect(parseGoogleCalendarSetting({})).toEqual({ clientId: null, calendarId: null });
    expect(parseGoogleCalendarSetting({ google_client_id: 'nope', google_calendar: 4 })).toEqual({
      clientId: null,
      calendarId: null,
    });
    expect(parseGoogleCalendarSetting({ google_calendar: '  ' }).calendarId).toBeNull();
  });
});
