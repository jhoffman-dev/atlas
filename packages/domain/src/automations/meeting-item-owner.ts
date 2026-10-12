/**
 * Whose a meeting's action item is (P29-05): the rule that splits "mine"
 * from "waiting for". The model names an owner in words; who that is — the
 * vault's owner, a person the vault has a note for, a name it has none for,
 * or nobody it can name — is decided here, from the meeting's attendees, the
 * vault's people and the profile, never by the model.
 */

import { matchAttendees, type DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import {
  isOwnerAttendee,
  isOwnerNote,
  ownerAddresses,
  sameName,
} from '../meeting-links/vault-owner.ts';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import { isSelfSpeaker, isUnnamedSpeaker } from '../meetings/transcript.ts';

export type ItemOwner =
  /** The vault's owner: the item is theirs to do. */
  | { readonly kind: 'self' }
  /** Someone the vault has exactly one Person note for. */
  | { readonly kind: 'person'; readonly name: string; readonly person: DirectoryPerson }
  /** Someone named, with no Person note to link — or more than one it could be. */
  | { readonly kind: 'named'; readonly name: string; readonly several: boolean }
  /** Nobody the answer could name: left for the person to say. */
  | { readonly kind: 'unknown' };

/** Who an item's owner may be found among. */
export interface OwnerDirectory {
  /** The meeting's attendees, as its frontmatter lists them. */
  readonly attendees: readonly MeetingAttendee[];
  readonly people: readonly DirectoryPerson[];
  /** The vault owner's name, from their profile. */
  readonly selfName: string | null;
}

/** Words a model writes for the vault's owner besides `You`. */
const SELF_WORDS = /^(?:me|i|myself|mine)$/i;
/** Words a model writes when it could not tell: none of them is a name. */
const NOBODY = /^(?:unknown|unclear|unassigned|nobody|no one|none|n\/?a|tbd|someone|\?+)$/i;

/** The owner as written, without the brackets and stars a transcript or a next step wraps a name in. */
function tidyOwner(written: string): string {
  return written
    .replace(/[[\]*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The attendee an owner's name means: one of that name, or — for a first
 * name alone — the only attendee whose name starts with it. A group address
 * is nobody.
 */
function attendeeNamed(
  name: string,
  attendees: readonly MeetingAttendee[],
): MeetingAttendee | null {
  const people = attendees.filter((attendee) => !attendee.group);
  const exact = people.find((attendee) => sameName(attendee.name, name));
  if (exact !== undefined) return exact;
  if (/\s/.test(name)) return null;
  const first = people.filter((attendee) => sameName(attendee.name.split(/\s+/)[0] ?? '', name));
  return first.length === 1 ? first[0]! : null;
}

/**
 * Whose an item is, from the owner its answer wrote. `You` (as a transcript
 * writes the owner), the profile's name, or a name or address the owner's own
 * Person note holds is the owner. Any other name is matched as an attendee
 * is (`matchAttendees`): one person is that person, none or several is the
 * name alone. Blank, or what a provider calls a speaker it could not name, is
 * nobody.
 */
export function itemOwner(written: string, directory: OwnerDirectory): ItemOwner {
  const name = tidyOwner(written);
  if (name === '' || isUnnamedSpeaker(name) || NOBODY.test(name)) return { kind: 'unknown' };
  if (isSelfSpeaker(name) || SELF_WORDS.test(name)) return { kind: 'self' };
  const { attendees, people, selfName } = directory;
  const attendee = attendeeNamed(name, attendees) ?? { name, email: null, group: false };
  const selfEmails = ownerAddresses(people, selfName);
  if (isOwnerAttendee({ attendee, selfName, selfEmails })) return { kind: 'self' };
  const matching = matchAttendees([attendee], people, []);
  const person = matching.linked[0]?.person;
  if (person !== undefined) {
    return isOwnerNote(person, selfName)
      ? { kind: 'self' }
      : { kind: 'person', name: person.name, person };
  }
  return { kind: 'named', name: attendee.name, several: matching.ambiguous.length > 0 };
}
