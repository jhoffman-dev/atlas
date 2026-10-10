import type { GoogleCalendar } from '@atlas/domain';
import type { GoogleCalendarPort, GoogleConnection } from '../google-calendar/ports.ts';

/**
 * Google Calendar in memory: a sign-in is kept per vault, and `next` makes the
 * next connect fail with that error instead — a refusal, a timeout.
 */
export function fakeGoogleCalendar(calendars: GoogleCalendar[] = []) {
  const connected = new Map<string, GoogleConnection>();
  const state = {
    next: null as Error | null,
    revoked: true,
    shared: false,
    cancels: 0,
    calendars,
  };
  const port: GoogleCalendarPort = {
    status: async ({ vault }) =>
      connected.get(vault) ?? { connected: false, clientId: null, scopes: [] },
    connect: async ({ vault, clientId, scopes }) => {
      if (state.next !== null) {
        const failure = state.next;
        state.next = null;
        throw failure;
      }
      const connection = { connected: true, clientId, scopes };
      connected.set(vault, connection);
      return connection;
    },
    cancelConnect: async () => {
      state.cancels += 1;
    },
    disconnect: async ({ vault }) => {
      connected.delete(vault);
      return { revoked: state.revoked, shared: state.shared };
    },
    listCalendars: async () => state.calendars,
    createCalendar: async ({ name }) => {
      const made = {
        id: `${name.toLowerCase().replace(/ /g, '-')}@group.calendar.example.com`,
        name,
        primary: false,
        owned: true,
      };
      state.calendars = [...state.calendars, made];
      return made;
    },
  };
  return { port, connected, state };
}
