import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import { vocabularyKey } from '../terms/spelling.ts';
import type { DirectoryPerson } from './attendee-matching.ts';

/**
 * A name as people write it, in the forms a profile and an attendee list
 * differ by: as written, and `Last, First` turned round. Spelt as the Terms
 * page compares spellings (composed, single-spaced, case folded).
 */
function nameForms(name: string): string[] {
  const forms = [vocabularyKey(name)];
  const parts = name.split(',');
  if (parts.length === 2) {
    const [last = '', first = ''] = parts;
    forms.push(vocabularyKey(`${first.trim()} ${last.trim()}`));
  }
  return forms.filter((form) => form !== '');
}

function sameName(left: string, right: string): boolean {
  const wanted = new Set(nameForms(right));
  return nameForms(left).some((form) => wanted.has(form));
}

/** An address as compared: the part in `<…>` when written as a mail client copies it, case folded. */
function addressKey(email: string): string {
  const bracketed = /<([^<>]+)>\s*$/.exec(email)?.[1] ?? email;
  return bracketed.normalize('NFC').trim().toLowerCase();
}

/** Whether a person's note is the owner's: its name or an alias is the profile's. */
export function isOwnerNote(person: DirectoryPerson, selfName: string | null): boolean {
  return (
    selfName !== null && [person.name, ...person.aliases].some((form) => sameName(form, selfName))
  );
}

/**
 * The addresses the vault owner has, read from their own Person note: the
 * person whose name — or alias — is the profile's. A profile holds no
 * address, but the owner's note usually does.
 */
export function ownerAddresses(
  people: readonly DirectoryPerson[],
  selfName: string | null,
): string[] {
  const mine = people.filter((person) => isOwnerNote(person, selfName));
  const addresses = mine.flatMap(({ emails }) => emails.map(addressKey));
  return [...new Set(addresses)].filter((email) => email !== '');
}

/**
 * Whether an attendee is the vault's owner: their name is the profile's in
 * any common spelling (`Last, First`, case, spacing), or their address is
 * one the owner's note holds. Never proposed as someone new.
 */
export function isOwnerAttendee({
  attendee,
  selfName,
  selfEmails,
}: {
  attendee: MeetingAttendee;
  selfName: string | null;
  selfEmails: readonly string[];
}): boolean {
  if (selfName !== null && sameName(attendee.name, selfName)) return true;
  return attendee.email !== null && selfEmails.includes(addressKey(attendee.email));
}
