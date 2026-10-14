import { addressesOf } from '../profile/email-addresses.ts';
import { parseSelfEmails } from '../profile/self-emails.ts';

/**
 * What the vault's settings note says about Granola (ADR-0034). Each setting
 * that changes what a meeting's file says lives in the vault, never on the
 * Mac, so every Mac that pulls — and n8n, whose OPTIONS are kept to the same
 * values — writes the same note into the same bytes.
 */

/** The zone a meeting's times are written on. */
export const GRANOLA_TIME_ZONE_KEY = 'granola_time_zone';
/** Whether Granola's webhooks reach the vault through n8n: a pull then warns of a note that came late. */
export const GRANOLA_WEBHOOK_KEY = 'granola_webhook';
/** Whether the app pulls every 15 minutes while the vault is open. */
export const GRANOLA_PERIODIC_KEY = 'granola_periodic';
/** Addresses that are groups the address rule misses, for each Granola meeting mapped into the vault. */
export const GRANOLA_GROUP_ADDRESSES_KEY = 'granola_group_addresses';

/** n8n's default zone too, so a vault that says nothing maps as the workflow does. */
export const DEFAULT_GRANOLA_TIME_ZONE = 'America/Los_Angeles';

export interface GranolaSettings {
  readonly timeZone: string;
  readonly webhook: boolean;
  readonly periodic: boolean;
  readonly groupAddresses: readonly string[];
  /**
   * The vault owner's own addresses (`selfEmails`, or its alias
   * `granola_self_emails`): a Granola note owned by one of them has its `me`
   * turns written as `You`, any other as the owner's name. None is a setting
   * too: every `me` is then the owner's name.
   */
  readonly selfEmails: readonly string[];
  /** Why `granola_group_addresses` could not be read; it then reads as none. */
  readonly groupAddressesProblem: string | null;
  /** Why the owner's addresses could not be read; they then read as none. */
  readonly selfEmailsProblem: string | null;
}

function timeZoneOf(value: unknown): string {
  const zone = typeof value === 'string' ? value.trim() : '';
  return zone === '' ? DEFAULT_GRANOLA_TIME_ZONE : zone;
}

/**
 * The settings, each unusable one read as its default. A zone that is text
 * but no zone is kept: the mapper refuses it by name, rather than a meeting
 * being written on a clock the vault did not ask for.
 */
export function parseGranolaSettings(settings: Readonly<Record<string, unknown>>): GranolaSettings {
  const groups = addressesOf(settings[GRANOLA_GROUP_ADDRESSES_KEY]);
  const self = parseSelfEmails(settings);
  return {
    timeZone: timeZoneOf(settings[GRANOLA_TIME_ZONE_KEY]),
    webhook: settings[GRANOLA_WEBHOOK_KEY] === true,
    periodic: settings[GRANOLA_PERIODIC_KEY] !== false,
    groupAddresses: groups.addresses,
    selfEmails: self.emails,
    groupAddressesProblem: groups.problem,
    selfEmailsProblem: self.problem,
  };
}
