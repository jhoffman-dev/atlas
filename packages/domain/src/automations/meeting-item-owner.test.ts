import { describe, expect, it } from 'vitest';
import type { DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { itemOwner, type OwnerDirectory } from './meeting-item-owner.ts';

/** P29-05: the mine / waiting-for split, from the owner an answer wrote in words. */

const person = (name: string, more: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  emails: [],
  aliases: [],
  company: null,
  ...more,
});
const TOBIAS = person('Tobias Fenn', { emails: ['tobias.fenn@example.com'] });
const DIRECTORY: OwnerDirectory = {
  attendees: [
    { name: 'Quill, Mara', email: 'mara.quill@example.com', group: false },
    { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
    { name: 'Tobias Reed', email: null, group: false },
    { name: 'platform-team', email: 'platform-team@example.com', group: true },
  ],
  people: [person('Mara Quill'), TOBIAS],
  selfName: 'Mara Quill',
  selfEmails: [],
};

describe('itemOwner', () => {
  it.each([
    'You',
    'you',
    'me',
    'I',
    'myself',
    '**You**',
    '[You]',
    'Mara Quill',
    'Quill, Mara',
    'mara  quill',
  ])('reads %j as the vault’s owner', (written) =>
    expect(itemOwner(written, DIRECTORY)).toEqual({ kind: 'self' }),
  );

  it.each([
    '',
    '  ',
    'Unknown',
    'Remote Speaker 2',
    'Speaker A',
    'unassigned',
    'TBD',
    'n/a',
    '??',
    'someone',
  ])('reads %j as nobody it can name', (written) =>
    expect(itemOwner(written, DIRECTORY)).toEqual({ kind: 'unknown' }),
  );

  it('reads another attendee as their Person note, however the answer wrapped the name', () => {
    expect(itemOwner('[Tobias Fenn]', DIRECTORY)).toEqual({
      kind: 'person',
      name: 'Tobias Fenn',
      person: TOBIAS,
    });
  });

  it('does not guess between two attendees of one first name', () => {
    expect(itemOwner('Tobias', DIRECTORY)).toEqual({
      kind: 'ambiguous',
      name: 'Tobias',
      candidates: ['Tobias Fenn', 'Tobias Reed'],
    });
  });

  it('reads a first name as the only attendee who has it', () => {
    const lone = { ...DIRECTORY, attendees: DIRECTORY.attendees.slice(0, 2) };

    expect(itemOwner('Tobias', lone)).toMatchObject({ kind: 'person', person: TOBIAS });
  });

  it('reads a name with no Person note as the name alone, and never a group address as a person', () => {
    expect(itemOwner('Ines Okafor', DIRECTORY)).toEqual({
      kind: 'named',
      name: 'Ines Okafor',
      inMeeting: false,
    });
    expect(itemOwner('platform-team', DIRECTORY)).toEqual({ kind: 'unknown' });
    expect(itemOwner('platform-team@example.com', DIRECTORY)).toEqual({ kind: 'unknown' });
  });

  it('says when several Person notes could be them', () => {
    const twins = {
      ...DIRECTORY,
      people: [
        ...DIRECTORY.people,
        person('Ines Okafor'),
        person('I. Okafor', { aliases: ['Ines Okafor'] }),
      ],
    };

    expect(itemOwner('Ines Okafor', twins)).toEqual({
      kind: 'ambiguous',
      name: 'Ines Okafor',
      candidates: ['I. Okafor', 'Ines Okafor'],
    });
  });

  it('knows the owner by an alias of their own note, and by its address, when the profile is spelt another way', () => {
    const aliased = {
      ...DIRECTORY,
      selfName: 'M. Quill',
      people: [
        person('Mara Quill', { aliases: ['M. Quill'], emails: ['mara.quill@example.com'] }),
        TOBIAS,
      ],
    };

    expect(itemOwner('Mara Quill', aliased)).toEqual({ kind: 'self' });
    expect(itemOwner('Mara Quill', { ...aliased, attendees: [] })).toEqual({ kind: 'self' });
  });

  it('with no profile name, only the transcript’s own words mean the owner', () => {
    const unnamed = { ...DIRECTORY, selfName: null };

    expect(itemOwner('You', unnamed)).toEqual({ kind: 'self' });
    // The profile names nobody: their own note is a person like any other.
    expect(itemOwner('Mara', { ...unnamed, attendees: [] })).toEqual({
      kind: 'named',
      name: 'Mara',
      inMeeting: false,
    });
    expect(itemOwner('Mara Quill', { ...unnamed, attendees: [] })).toMatchObject({
      kind: 'person',
      name: 'Mara Quill',
    });
  });

  it.each([
    'You.',
    'You (Mara Quill)',
    'Mara Quill (the vault’s owner)',
    'Mara Quill: the vault’s owner',
    'Quill, Mara',
    'MARA QUILL',
    'Mara',
    'mara.quill@example.com',
    'Mara Quill <mara.quill@example.com>',
  ])('reads %j as the vault’s owner', (written) =>
    expect(itemOwner(written, OWNED)).toEqual({ kind: 'self' }),
  );

  it('does not read a first name as the owner when another attendee has it', () => {
    const shared = {
      ...OWNED,
      attendees: [...OWNED.attendees, { name: 'Mara Lee', email: null, group: false }],
    };

    expect(itemOwner('Mara', shared)).toMatchObject({ kind: 'ambiguous' });
    expect(itemOwner('Mara Lee', shared)).toMatchObject({ kind: 'named', name: 'Mara Lee' });
  });

  it.each(['We', 'us', 'we'])('reads %j as the owner’s, with a doubt to say', (written) => {
    const owner = itemOwner(written, OWNED);

    expect(owner).toMatchObject({ kind: 'self' });
    expect('doubt' in owner && owner.doubt).toContain('“We”');
  });

  it.each(['Everyone', 'The team', 'All', 'Not sure', 'TBD', 'everybody', 'all of us'])(
    'reads %j as nobody',
    (written) => expect(itemOwner(written, OWNED)).toEqual({ kind: 'unknown' }),
  );

  it('reads a piped link as the note it points at', () => {
    expect(itemOwner('[[People/Tobias Fenn|Toby]]', OWNED)).toMatchObject({
      kind: 'person',
      name: 'Tobias Fenn',
    });
    expect(itemOwner('[[People/Mara Quill|me]]', OWNED)).toEqual({ kind: 'self' });
  });

  it('gives a joint item to the owner when they are one of the owners, naming the other', () => {
    const owner = itemOwner('You and Tobias', OWNED);

    expect(owner).toMatchObject({ kind: 'self' });
    expect('doubt' in owner && owner.doubt).toContain('Tobias');
    expect(itemOwner('Tobias & Mara Quill', OWNED)).toMatchObject({ kind: 'self' });
  });

  it('cannot give a joint item to people who are not the owner to one of them', () => {
    expect(itemOwner('Tobias Fenn and Lena Hart', OWNED)).toEqual({
      kind: 'ambiguous',
      name: 'Tobias Fenn and Lena Hart',
      candidates: ['Tobias Fenn', 'Lena Hart'],
    });
  });

  it('knows a person who is in the meeting from a name that is in no meeting and no note', () => {
    expect(itemOwner('Lena Hart', OWNED)).toMatchObject({ kind: 'named', inMeeting: true });
    expect(itemOwner('Ines Okafor', OWNED)).toMatchObject({ kind: 'named', inMeeting: false });
  });
});

/** Mara owns the vault, with a first name no one else in the meeting shares. */
const OWNED: OwnerDirectory = {
  attendees: [
    { name: 'Mara Quill', email: 'mara.quill@example.com', group: false },
    { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
    { name: 'Lena Hart', email: null, group: false },
  ],
  people: [person('Mara Quill', { emails: ['mara.quill@example.com'] }), TOBIAS],
  selfName: 'Mara Quill',
  selfEmails: [],
};

/** #173: the owner's addresses are the vault's `selfEmails`, with no Person note for the owner. */
describe('itemOwner, by the vault’s own addresses', () => {
  /** A vault with no Person note for its owner: only Tobias has one. */
  const NO_OWNER_NOTE: OwnerDirectory = {
    attendees: [
      { name: 'mq', email: 'Mara.Quill@example.com', group: false },
      { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
    ],
    people: [TOBIAS],
    selfName: null,
    selfEmails: ['mara.quill@example.com'],
  };

  it('knows the owner by an address alone: written as one, or as the attendee who has it', () => {
    expect(itemOwner('mara.quill@example.com', NO_OWNER_NOTE)).toEqual({ kind: 'self' });
    expect(itemOwner('Mara Q <MARA.QUILL@example.com>', NO_OWNER_NOTE)).toEqual({ kind: 'self' });
    expect(itemOwner('mq', NO_OWNER_NOTE)).toEqual({ kind: 'self' });
    expect(itemOwner('mara.quill@example.com', { ...NO_OWNER_NOTE, attendees: [] })).toEqual({
      kind: 'self',
    });
  });

  it('knows the owner by an address an attendee list holds twice, under two names', () => {
    const twice = {
      ...NO_OWNER_NOTE,
      attendees: [
        { name: 'mq', email: 'mara.quill@example.com', group: false },
        { name: 'M. Quill', email: 'mara.quill@example.com', group: false },
      ],
    };

    expect(itemOwner('mara.quill@example.com', twice)).toEqual({ kind: 'self' });
    // Without the address set, two attendees of one address are a guess between them.
    expect(itemOwner('mara.quill@example.com', { ...twice, selfEmails: [] })).toMatchObject({
      kind: 'ambiguous',
    });
  });

  it('knows the owner as the attendee of the name written, when that attendee is at an address of theirs', () => {
    const listed = {
      ...NO_OWNER_NOTE,
      attendees: [{ name: 'Mara Q', email: 'mara.quill@example.com', group: false }],
    };

    expect(itemOwner('Mara Q <mq@other.example>', listed)).toEqual({ kind: 'self' });
    expect(itemOwner('Mara Q <mq@other.example>', { ...listed, selfEmails: [] })).toMatchObject({
      kind: 'named',
    });
  });

  it('knows the owner by name alone, with no address set', () => {
    const named = { ...NO_OWNER_NOTE, selfName: 'Mara Quill', selfEmails: [] };

    expect(itemOwner('Mara Quill', named)).toEqual({ kind: 'self' });
    // No address: the attendee at Mara's address, under another name, is not known to be her.
    expect(itemOwner('mq', named)).toEqual({ kind: 'named', name: 'mq', inMeeting: true });
  });

  it('with neither, only the transcript’s own words are the owner', () => {
    const neither = { ...NO_OWNER_NOTE, selfEmails: [] };

    expect(itemOwner('You', neither)).toEqual({ kind: 'self' });
    expect(itemOwner('mara.quill@example.com', neither)).toMatchObject({ kind: 'named' });
    expect(itemOwner('Mara Quill', neither)).toMatchObject({ kind: 'named', inMeeting: false });
  });

  it('never reads another attendee as the owner for sharing a domain', () => {
    expect(itemOwner('tobias.fenn@example.com', NO_OWNER_NOTE)).toMatchObject({
      kind: 'person',
      person: TOBIAS,
    });
  });
});
