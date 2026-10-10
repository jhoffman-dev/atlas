import { describe, expect, it } from 'vitest';
import { calendarListPage, calendarOf, createdCalendarOf } from './calendar-list.ts';

describe('calendarOf', () => {
  it('reads a calendar from the API’s wire form', () => {
    expect(
      calendarOf({
        kind: 'calendar#calendarListEntry',
        id: 'atlas-blocks@group.calendar.example.com',
        summary: 'Atlas blocks',
        accessRole: 'owner',
      }),
    ).toEqual({
      id: 'atlas-blocks@group.calendar.example.com',
      name: 'Atlas blocks',
      primary: false,
      owned: true,
    });
  });

  it('marks the main calendar and one shared with the person', () => {
    expect(calendarOf({ id: 'a', summary: 'A', primary: true, accessRole: 'owner' })?.primary).toBe(
      true,
    );
    expect(calendarOf({ id: 'b', summary: 'B', accessRole: 'writer' })?.owned).toBe(false);
  });

  it('leaves out an entry without an id or a name', () => {
    for (const entry of [null, 'x', [], { summary: 'A' }, { id: '', summary: 'A' }, { id: 'a' }]) {
      expect(calendarOf(entry)).toBeNull();
    }
  });
});

describe('calendarListPage', () => {
  it('reads the calendars and the next page', () => {
    const page = calendarListPage({
      items: [{ id: 'a', summary: 'A', accessRole: 'owner' }, { broken: true }],
      nextPageToken: 'p2',
    });
    expect(page?.calendars.map((calendar) => calendar.id)).toEqual(['a']);
    expect(page?.next).toBe('p2');
  });

  it('reads a last page with no calendars', () => {
    expect(calendarListPage({})).toEqual({ calendars: [], next: null });
  });

  it('is nothing for a body that is not a page', () => {
    expect(calendarListPage([])).toBeNull();
    expect(calendarListPage('items')).toBeNull();
  });
});

describe('createdCalendarOf', () => {
  it('is the person’s own and never their main calendar', () => {
    expect(createdCalendarOf({ id: 'c', summary: 'Atlas blocks', primary: true })).toEqual({
      id: 'c',
      name: 'Atlas blocks',
      primary: false,
      owned: true,
    });
    expect(createdCalendarOf({ summary: 'Atlas blocks' })).toBeNull();
  });
});
