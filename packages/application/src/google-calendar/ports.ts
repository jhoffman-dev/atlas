import type { GoogleCalendar, GoogleFailure } from '@atlas/domain';

/** Whether this vault has a Google sign-in on this Mac, and what it is for. Never a token. */
export interface GoogleConnection {
  readonly connected: boolean;
  readonly clientId: string | null;
  readonly scopes: readonly string[];
}

/**
 * Google Calendar, through the host (ADR-0030). The host keeps the tokens and
 * answers with none of them; every call names the vault it is for, so one
 * that lands after a switch is refused rather than sent with the other's.
 */
export interface GoogleCalendarPort {
  status(args: { vault: string }): Promise<GoogleConnection>;
  /**
   * Signs in in the person's browser. Settles once Google sends the browser
   * back, the sign-in is cancelled, or it runs out of time.
   */
  connect(args: {
    vault: string;
    clientId: string;
    /** Only for a client Google issued one to; left out, the one kept with the last sign-in is used. */
    clientSecret?: string;
    scopes: readonly string[];
  }): Promise<GoogleConnection>;
  /** Ends the sign-in waiting in the browser, if there is one. */
  cancelConnect(): Promise<void>;
  /**
   * Forgets the sign-in. `revoked` is false when Google was not told: it
   * could not be reached, or — `shared` — another vault on this Mac signs in
   * with the same client, and revoking might end that one's sign-in too.
   */
  disconnect(args: {
    vault: string;
  }): Promise<{ readonly revoked: boolean; readonly shared: boolean }>;
  listCalendars(args: { vault: string }): Promise<readonly GoogleCalendar[]>;
  createCalendar(args: { vault: string; name: string }): Promise<GoogleCalendar>;
}

/** A Google Calendar call that failed, with what the host or the API said. */
export class GoogleCalendarError extends Error {
  readonly failure: GoogleFailure;

  constructor(failure: GoogleFailure) {
    super(failure.message);
    this.name = 'GoogleCalendarError';
    this.failure = failure;
  }
}
