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
/**
 * The vault person's own addresses: a Granola note owned by one of them has
 * its `me` turns written as `You`, any other as the owner's name. None is a
 * setting too: every `me` is then the owner's name.
 */
export const GRANOLA_SELF_EMAILS_KEY = 'granola_self_emails';

/** n8n's default zone too, so a vault that says nothing maps as the workflow does. */
export const DEFAULT_GRANOLA_TIME_ZONE = 'America/Los_Angeles';

export interface GranolaSettings {
  readonly timeZone: string;
  readonly webhook: boolean;
  readonly periodic: boolean;
  readonly groupAddresses: readonly string[];
  readonly selfEmails: readonly string[];
}

function timeZoneOf(value: unknown): string {
  const zone = typeof value === 'string' ? value.trim() : '';
  return zone === '' ? DEFAULT_GRANOLA_TIME_ZONE : zone;
}

/** The addresses a setting lists; one written as text rather than a list is a list of that one. */
function addressesOf(value: unknown): readonly string[] {
  const listed: readonly unknown[] = Array.isArray(value) ? value : [value];
  return listed
    .filter((each): each is string => typeof each === 'string')
    .map((each) => each.trim())
    .filter((each) => each !== '');
}

/**
 * The settings, each unusable one read as its default. A zone that is text
 * but no zone is kept: the mapper refuses it by name, rather than a meeting
 * being written on a clock the vault did not ask for.
 */
export function parseGranolaSettings(settings: Readonly<Record<string, unknown>>): GranolaSettings {
  return {
    timeZone: timeZoneOf(settings[GRANOLA_TIME_ZONE_KEY]),
    webhook: settings[GRANOLA_WEBHOOK_KEY] === true,
    periodic: settings[GRANOLA_PERIODIC_KEY] !== false,
    groupAddresses: addressesOf(settings[GRANOLA_GROUP_ADDRESSES_KEY]),
    selfEmails: addressesOf(settings[GRANOLA_SELF_EMAILS_KEY]),
  };
}

/** What was typed as the person's own addresses: the addresses, or why they cannot be kept. */
export type GranolaSelfEmailsReading =
  | { readonly ok: true; readonly emails: readonly string[] }
  | { readonly ok: false; readonly problem: string };

/** An address as it is typed or pasted: something, an @, and a domain with a dot in it. */
const ADDRESS = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[^\s@<>()[\]",;:\\.]+$/;
/**
 * One piece of what was typed: an address in angle brackets with the name
 * before it (`Mara Quill <mara.quill@example.com>`, the name quoted or not),
 * or a run of text between separators.
 */
const PIECE =
  /((?:"[^"]*"|[^\s,;<>"]+)(?:[ \t]+(?:"[^"]*"|[^\s,;<>"]+))*)?[ \t]*<([^<>]*)>|[^\s,;]+/g;

const isAddress = (text: string) => ADDRESS.test(text);

/** Each word of a name before `<address>` that is itself an address: one typed bare beside it. */
function addressesInName(name: string | undefined): string[] {
  return (name ?? '').split(/\s+/).filter(isAddress);
}

/**
 * The addresses typed into Settings → Granola, however they were separated
 * (commas, semicolons, spaces or lines) and whether bare or as `Name
 * <address>`: each once, in lower case, in the order typed. Anything else
 * typed is not an address, and is named rather than kept, so nothing that is
 * not an address is ever saved as one.
 */
export function granolaSelfEmailsFromText(text: string): GranolaSelfEmailsReading {
  const found: string[] = [];
  const notAddresses: string[] = [];
  for (const [piece, name, angled] of text.matchAll(PIECE)) {
    if (angled === undefined) {
      (isAddress(piece) ? found : notAddresses).push(piece);
      continue;
    }
    const address = angled.trim();
    found.push(...addressesInName(name));
    if (isAddress(address)) found.push(address);
    else notAddresses.push(piece.trim());
  }
  if (notAddresses.length > 0) {
    const named = notAddresses.map((each) => `“${each}”`).join(', ');
    return { ok: false, problem: `Not an email address: ${named}. Nothing was saved.` };
  }
  return { ok: true, emails: [...new Set(found.map((each) => each.toLowerCase()))] };
}
