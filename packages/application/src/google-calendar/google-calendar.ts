import {
  canHoldBlocks,
  explainGoogleFailure,
  parseGoogleCalendarSetting,
  parseGoogleClientId,
  DEDICATED_CALENDAR_NAME,
  GOOGLE_CALENDAR_KEY,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_CLIENT_ID_KEY,
  type GoogleCalendar,
  type GoogleCalendarSetting,
  type GoogleProblem,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { GoogleCalendarError, type GoogleCalendarPort, type GoogleConnection } from './ports.ts';

/** What the person should read for anything a Google Calendar step threw. */
export function googleProblemOf(cause: unknown): GoogleProblem {
  if (cause instanceof GoogleCalendarError) return explainGoogleFailure(cause.failure);
  return { problem: cause instanceof Error ? cause.message : String(cause), fix: null };
}

const NOT_A_CLIENT_ID =
  'That is not a Google OAuth client ID: it ends in .apps.googleusercontent.com.';

/**
 * Signs in to Google Calendar with the client typed, asking for Atlas's one
 * scope. A client secret is sent only when one was typed: a client Google
 * issued none to needs none (ADR-0030).
 */
export async function connectGoogleCalendar({
  port,
  vault,
  clientId,
  clientSecret,
}: {
  port: GoogleCalendarPort;
  vault: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleConnection> {
  const client = parseGoogleClientId(clientId);
  if (client === null) {
    throw new GoogleCalendarError({ kind: 'invalid', message: NOT_A_CLIENT_ID });
  }
  const secret = clientSecret.trim();
  return port.connect({
    vault,
    clientId: client,
    scopes: GOOGLE_CALENDAR_SCOPES,
    ...(secret === '' ? {} : { clientSecret: secret }),
  });
}

/** The calendars blocks may go to, by name. */
export async function blockCalendars({
  port,
  vault,
}: {
  port: GoogleCalendarPort;
  vault: string;
}): Promise<readonly GoogleCalendar[]> {
  const calendars = await port.listCalendars({ vault });
  return calendars.filter(canHoldBlocks).sort((left, right) => left.name.localeCompare(right.name));
}

/** Makes the calendar blocks go to, under Atlas's name for it. */
export function createBlocksCalendar({
  port,
  vault,
}: {
  port: GoogleCalendarPort;
  vault: string;
}): Promise<GoogleCalendar> {
  return port.createCalendar({ vault, name: DEDICATED_CALENDAR_NAME });
}

const NOT_REVOKED: GoogleProblem = {
  problem: 'Atlas forgot the sign-in, but could not tell Google to revoke it.',
  fix: 'Remove Atlas from the third-party access in your Google Account’s security settings.',
};

const SHARED: GoogleProblem = {
  problem:
    'Atlas forgot the sign-in for this vault, but did not ask Google to revoke it: another vault on this Mac connects with the same client, and revoking could disconnect that one too.',
  fix: 'To end Atlas’s access altogether, disconnect the other vault as well.',
};

/** Forgets the sign-in. Returns what the person still has to do, or null when nothing. */
export async function disconnectGoogleCalendar({
  port,
  vault,
}: {
  port: GoogleCalendarPort;
  vault: string;
}): Promise<GoogleProblem | null> {
  const { revoked, shared } = await port.disconnect({ vault });
  if (shared) return SHARED;
  return revoked ? null : NOT_REVOKED;
}

/** The client and calendar the vault's settings name. */
export async function loadGoogleCalendarSetting(args: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<GoogleCalendarSetting> {
  return parseGoogleCalendarSetting(await readVaultSettings(args));
}

/** Writes the client and calendar into the vault's settings. */
export async function saveGoogleCalendarSetting({
  settings,
  setting,
}: {
  settings: SettingsWriter;
  setting: GoogleCalendarSetting;
}): Promise<void> {
  await settings.save({
    [GOOGLE_CLIENT_ID_KEY]: setting.clientId,
    [GOOGLE_CALENDAR_KEY]: setting.calendarId,
  });
}
