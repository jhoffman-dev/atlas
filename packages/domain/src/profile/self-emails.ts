import { addressesOf, readAddresses, type AddressesReading } from './email-addresses.ts';

/**
 * The vault owner's own email addresses (ADR-0024 amendment, ADR-0036): one
 * setting beside the profile's names, kept in the vault so it syncs. Linking,
 * whose an action item is, Granola's `me` and the duplicate rule all read it.
 * Atlas ships no address and guesses none: the person types them.
 */
export const SELF_EMAILS_KEY = 'selfEmails';

/**
 * Where Settings → Granola kept the same addresses before `selfEmails`
 * (ADR-0034): read in its place while `selfEmails` holds none, and left where
 * it is, so a vault set up for Granola maps every meeting as it did.
 */
export const GRANOLA_SELF_EMAILS_KEY = 'granola_self_emails';

/** The key the owner's addresses were read from. */
export type SelfEmailsSource = typeof SELF_EMAILS_KEY | typeof GRANOLA_SELF_EMAILS_KEY;

/** The owner's addresses as the vault's settings hold them. */
export interface SelfEmails {
  /** Each once, in lower case; none when nothing is set or what is set cannot be read. */
  readonly emails: readonly string[];
  /** The key they were read from; null when neither holds any. */
  readonly source: SelfEmailsSource | null;
  /** Why the key read could not be: its addresses then read as none. */
  readonly problem: string | null;
}

/** What was typed as the owner's addresses: the addresses, or why they cannot be kept. */
export type SelfEmailsReading = AddressesReading;

/**
 * The owner's addresses: `selfEmails`, or `granola_self_emails` while
 * `selfEmails` holds none (missing, null, blank or an empty list). Both are
 * read by the strict address reader, not cleaned as a name is: an address
 * with an invisible character in it is refused and named, never quietly made
 * into another address. A `selfEmails` that cannot be read is not empty: it
 * reads as no address and says why, and the alias is not read in its place,
 * so nothing is guessed from a setting the person did not mean.
 */
export function parseSelfEmails(settings: Readonly<Record<string, unknown>>): SelfEmails {
  const own = addressesOf(settings[SELF_EMAILS_KEY]);
  if (own.addresses.length > 0 || own.problem !== null) {
    return { emails: own.addresses, source: SELF_EMAILS_KEY, problem: own.problem };
  }
  const alias = addressesOf(settings[GRANOLA_SELF_EMAILS_KEY]);
  if (alias.addresses.length > 0 || alias.problem !== null) {
    return { emails: alias.addresses, source: GRANOLA_SELF_EMAILS_KEY, problem: alias.problem };
  }
  return { emails: [], source: null, problem: null };
}

/**
 * The addresses typed into Settings → Profile, however they were separated
 * (commas, semicolons, spaces or lines) and whether bare or as `Name
 * <address>` (the name quoted or not, `\"` inside the quotes, the name on the
 * line before): each once, in lower case, in the order typed. Anything else
 * typed is not an address, and is named rather than kept, so nothing that is
 * not an address is ever saved as one. More than 10 KB is refused unread.
 */
export function selfEmailsFromText(text: string): SelfEmailsReading {
  const read = readAddresses(text);
  return read.ok ? read : { ok: false, problem: `${read.problem} Nothing was saved.` };
}

/**
 * The settings change that keeps the owner's addresses: under `selfEmails`
 * alone, the alias left as the file holds it. None removes the key rather
 * than writing an empty list.
 */
export function selfEmailsSettingsChanges(
  emails: readonly string[],
): Record<typeof SELF_EMAILS_KEY, readonly string[] | null> {
  return { [SELF_EMAILS_KEY]: emails.length === 0 ? null : emails };
}
