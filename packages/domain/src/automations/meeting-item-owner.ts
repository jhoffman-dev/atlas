/**
 * Whose a meeting's action item is (P29-05): the rule that splits "mine"
 * from "waiting for". The model names an owner in words; who that is — the
 * vault's owner, a person the vault has a note for, a name it has none for,
 * or nobody it can name — is decided here, from the meeting's attendees, the
 * vault's people and the profile, never by the model.
 *
 * Only what is certain is a person. A name that could be two people, a group,
 * "everyone", and a name nobody in the meeting or the vault has are guesses,
 * and say so.
 */

import { matchAttendees, type DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import {
  isOwnerAttendee,
  isOwnerNote,
  ownerAddressesInUse,
  ownerNotAGroup,
  sameName,
} from '../meeting-links/vault-owner.ts';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import { comparableAddress } from '../profile/email-addresses.ts';
import { isSelfSpeaker, isUnnamedSpeaker } from '../meetings/transcript.ts';
import { vocabularyKey } from '../terms/spelling.ts';

export type ItemOwner =
  /**
   * The vault's owner: the item is theirs to do. `doubt` is set when that
   * rests on a reading, and `shared` says which: "we", or the owner named
   * with others.
   */
  | { readonly kind: 'self'; readonly doubt?: string; readonly shared?: 'we' | 'with-others' }
  /** Someone the vault has exactly one Person note for. */
  | { readonly kind: 'person'; readonly name: string; readonly person: DirectoryPerson }
  /**
   * Someone named with no Person note to link. `inMeeting` is whether the
   * meeting lists them: a name that is neither is only the model's word.
   */
  | { readonly kind: 'named'; readonly name: string; readonly inMeeting: boolean }
  /** More than one person it could be, or more than one named: left for the person to say. */
  | { readonly kind: 'ambiguous'; readonly name: string; readonly candidates: readonly string[] }
  /** Nobody the answer could name: left for the person to say. */
  | { readonly kind: 'unknown' };

/** Who an item's owner may be found among. */
export interface OwnerDirectory {
  /** The meeting's attendees, as its frontmatter lists them. */
  readonly attendees: readonly MeetingAttendee[];
  readonly people: readonly DirectoryPerson[];
  /** The vault owner's name, from their profile. */
  readonly selfName: string | null;
  /** The vault owner's own addresses, the vault's `selfEmails`: an attendee at one is them. */
  readonly selfEmails: readonly string[];
}

/** Words a model writes for the vault's owner besides `You`. */
const SELF_WORDS = /^(?:me|i|myself|mine)$/i;
/** Words for the speaker and some others: it is the owner's task to check. */
const WE_WORDS = /^(?:we|us|ourselves|both of us|the two of us)$/i;
/** Words a model writes when it could not tell, or meant many: none of them is a name. */
const NOBODY =
  /^(?:unknown|unclear|unassigned|nobody|no one|none|n\/?a|tbd|someone|somebody|everyone|everybody|all|all of us|the team|team|the group|not sure|unsure|to be decided|to be determined|\?+)$/i;
/** Between two owners of one item. */
const JOINT = /\s+(?:and|&|\+)\s+/i;
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * The owner as written, without what a model wraps a name in: a link's
 * brackets (reading `[[People/X|Y]]` as X), stars, a gloss in brackets or
 * after a colon, and the full stop of a sentence.
 */
function tidyOwner(written: string): string {
  return written
    .replace(/\[\[([^\]|#]*)(?:[|#][^\]]*)?\]\]/g, (_, target: string) => lastSegment(target))
    .replace(/[[\]*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s*:\s*the vault.s owner\.?$/i, '')
    .replace(/[.,;:!]+$/, '')
    .trim();
}

function lastSegment(target: string): string {
  return (target.split('/').pop() ?? '').replace(/\.md$/i, '').trim();
}

/** The full stop or other mark a sentence ends an owner with: no part of an address. */
const SENTENCE_END = /[.,;:!?]+$/;
/** Quotes and brackets around an owner, as a model writes `(mara@…)` or `“mara@…”`. */
const OPENING = /^["'“‘([]+/;
const CLOSING = /["'”’)\]]+$/;

/**
 * The owner without the sentence's end or the quotes and brackets around it,
 * however they nest (`(mara@example.com).`): each pass takes something off,
 * so it ends.
 */
function unwrapped(written: string): string {
  let text = written.trim();
  for (let before = ''; text !== before;) {
    before = text;
    text = text.replace(SENTENCE_END, '').replace(OPENING, '').replace(CLOSING, '').trim();
  }
  return text;
}

/**
 * An owner written as an address: bare, or the way a mail client copies it,
 * either one perhaps ending a sentence or in quotes or brackets. Null when it is a name.
 */
function addressOf(written: string): { name: string; email: string } | null {
  const text = unwrapped(written);
  const bracketed = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  const email = (bracketed?.[2] ?? text).trim();
  if (!ADDRESS.test(email)) return null;
  const name = (bracketed?.[1] ?? '').replace(/^["']|["']$/g, '').trim();
  return { name: name === '' ? email : name, email };
}

const firstNameOf = (name: string): string => {
  const [last = '', first = ''] = name.includes(',') ? name.split(',') : [];
  return vocabularyKey((name.includes(',') ? first.trim() || last : name).split(/\s+/)[0] ?? '');
};

/**
 * The attendees an owner could be: those of that name or address, else —
 * for a first name alone — every attendee whose name starts with it.
 */
function attendeesNamed(owner: { name: string; email: string | null }, directory: OwnerDirectory) {
  const all = directory.attendees;
  if (owner.email !== null) {
    const addressed = all.filter(
      (each) =>
        each.email !== null && comparableAddress(each.email) === comparableAddress(owner.email!),
    );
    if (addressed.length > 0) return addressed;
  }
  const exact = all.filter((each) => sameName(each.name, owner.name));
  if (exact.length > 0) return exact;
  if (/\s/.test(owner.name) || owner.email !== null) return [];
  return all.filter((each) => !each.group && firstNameOf(each.name) === vocabularyKey(owner.name));
}

/** Whether `name` is the profile's first name and no other attendee has it. */
function isOwnersFirstName(name: string, { attendees, selfName }: OwnerDirectory): boolean {
  if (selfName === null || /\s|@/.test(name)) return false;
  if (firstNameOf(selfName) !== vocabularyKey(name)) return false;
  return !attendees.some(
    (each) =>
      !each.group &&
      !sameName(each.name, selfName) &&
      firstNameOf(each.name) === vocabularyKey(name),
  );
}

/** Whether a single owner, with no and/&, is the vault's owner. */
function isSelf(owner: { name: string; email: string | null }, directory: OwnerDirectory): boolean {
  const { selfName, selfEmails } = directory;
  const { name, email } = owner;
  if (email === null && (isSelfSpeaker(name) || SELF_WORDS.test(name))) return true;
  if (selfName !== null && sameName(name, selfName)) return true;
  if (email === null && isOwnersFirstName(name, directory)) return true;
  // Only an attendee that is the one it could be: two of a first name are neither.
  const listed = attendeesNamed(owner, directory).filter((each) => !each.group);
  const attendee = (listed.length === 1 ? listed[0] : undefined) ?? { name, email, group: false };
  return isOwnerAttendee({
    attendee: { ...attendee, email: email ?? attendee.email },
    selfName,
    selfEmails,
  });
}

function ownerOf(written: string): { name: string; email: string | null } {
  const address = addressOf(written);
  return address === null ? { name: tidyOwner(written), email: null } : address;
}

/**
 * Whose an item is, from the owner its answer wrote. `You` (as a transcript
 * writes the owner), the profile's name in its common spellings, its first
 * name when no other attendee has it, or any of the vault's `selfEmails` is
 * the owner; "we" is the owner's too, to check. Any other name
 * or address is matched as an attendee is (`matchAttendees`): one person is
 * that person; a first name two attendees share, or several Person notes, is
 * ambiguous; a group, "everyone", blank, or what a provider calls a speaker
 * it could not name is nobody. Two owners ("You and Tobias") are not split
 * into two items: the owner's task when they are one of them, ambiguous
 * otherwise.
 */
export function itemOwner(written: string, directory: OwnerDirectory): ItemOwner {
  return ownerIn(written, asTheOwnerSaid(directory));
}

/**
 * The directory as the owner is found in it (ADR-0024 amendment): an
 * attendee at one of the vault's `selfEmails` is the owner even when a group
 * rule read their address as a group's, and with no `selfEmails` the
 * owner's own Person note's addresses are theirs, as before the setting.
 */
function asTheOwnerSaid(directory: OwnerDirectory): OwnerDirectory {
  const { attendees, people, selfName, selfEmails } = directory;
  return {
    attendees: ownerNotAGroup(attendees, selfEmails),
    people,
    selfName,
    selfEmails: ownerAddressesInUse({ selfEmails, people, selfName }),
  };
}

function ownerIn(written: string, directory: OwnerDirectory): ItemOwner {
  const whole = tidyOwner(written);
  const joint = jointOwners(whole);
  if (joint !== null) return jointOwner(joint, whole, directory);
  const owner = ownerOf(written);
  const { name } = owner;
  if (name === '' || isUnnamedSpeaker(name) || NOBODY.test(name)) return { kind: 'unknown' };
  if (owner.email === null && WE_WORDS.test(name)) {
    return {
      kind: 'self',
      doubt: 'Claude wrote “We”, which may be you or others, so check whose it is.',
      shared: 'we',
    };
  }
  if (isSelf(owner, directory)) return { kind: 'self' };
  return otherOwner(owner, directory);
}

function jointOwners(whole: string): string[] | null {
  const parts = whole.split(JOINT).map((part) => part.trim());
  return parts.length > 1 && parts.every((part) => part !== '') ? parts : null;
}

function jointOwner(parts: readonly string[], whole: string, directory: OwnerDirectory): ItemOwner {
  const owners = parts.map((part) => ({ part, owner: ownerIn(part, directory) }));
  const others = owners.filter(({ owner }) => owner.kind !== 'self').map(({ part }) => part);
  if (others.length < owners.length) {
    const named = others.length === 0 ? 'others' : others.join(' and ');
    return {
      kind: 'self',
      doubt: `Claude named you and ${named} for this, and an item has one owner: it is yours, so check who else is on it.`,
      shared: 'with-others',
    };
  }
  return { kind: 'ambiguous', name: whole, candidates: parts };
}

/** Someone who is not the owner: the person they are, or the guess they are. */
function otherOwner(
  owner: { name: string; email: string | null },
  directory: OwnerDirectory,
): ItemOwner {
  const { people, selfName, selfEmails } = directory;
  const named = attendeesNamed(owner, directory);
  // A group took nothing on: a list is not who an item waits on.
  if (named.length > 0 && named.every((each) => each.group)) return { kind: 'unknown' };
  const listed = named.filter((each) => !each.group);
  if (listed.length > 1) {
    return { kind: 'ambiguous', name: owner.name, candidates: listed.map((each) => each.name) };
  }
  const attendee = listed[0] ?? { name: owner.name, email: owner.email, group: false };
  if (isOwnerAttendee({ attendee, selfName, selfEmails })) {
    return { kind: 'self' };
  }
  const matching = matchAttendees([attendee], people, []);
  const person = matching.linked[0]?.person;
  if (person !== undefined) {
    return isOwnerNote(person, selfName)
      ? { kind: 'self' }
      : { kind: 'person', name: person.name, person };
  }
  const several = matching.ambiguous[0]?.candidates;
  if (several !== undefined) {
    return {
      kind: 'ambiguous',
      name: attendee.name,
      candidates: several.map((each) => each.name).sort(),
    };
  }
  return { kind: 'named', name: attendee.name, inMeeting: listed.length === 1 };
}
