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
  speakers: [],
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
  speakers: [],
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
    speakers: [],
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

/** #173 review: an owner's address ending a sentence, the group rule, and where the owner's addresses come from. */
describe('itemOwner, by the owner’s addresses as written and as set', () => {
  const MARA = 'mara.quill@example.com';
  const directory: OwnerDirectory = {
    attendees: [
      { name: 'Mara Quill', email: MARA, group: false },
      { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
    ],
    people: [TOBIAS],
    selfName: null,
    selfEmails: [MARA],
    speakers: [],
  };

  it.each([
    `${MARA}.`,
    `${MARA}!`,
    `(${MARA}).`,
    `“${MARA}”`,
    `"${MARA}."`,
    `[${MARA}]`,
    `Mara Quill <${MARA}>,`,
    `Mara Quill <${MARA}>.`,
  ])('reads %j as the owner’s address', (written) =>
    expect(itemOwner(written, directory)).toEqual({ kind: 'self' }),
  );

  it('reads another attendee’s address ending a sentence as theirs, not the owner’s', () => {
    expect(itemOwner('tobias.fenn@example.com.', directory)).toMatchObject({
      kind: 'person',
      person: TOBIAS,
    });
  });

  it('reads an attendee at a selfEmails address as the owner, though a group rule made it a group', () => {
    const grouped = {
      ...directory,
      attendees: [{ name: 'Studio', email: 'team@quill.example', group: true }],
      selfEmails: ['team@quill.example'],
    };

    expect(itemOwner('Studio', grouped)).toEqual({ kind: 'self' });
    expect(itemOwner('team@quill.example', grouped)).toEqual({ kind: 'self' });
    // Without the owner's word for it, a group is still nobody's.
    expect(itemOwner('Studio', { ...grouped, selfEmails: [] })).toEqual({ kind: 'unknown' });
  });

  it('never reads a group as the owner for an address only the owner’s Person note holds', () => {
    const grouped = {
      attendees: [{ name: 'Studio', email: 'team@quill.example', group: true }],
      people: [person('Mara Quill', { emails: ['team@quill.example'] })],
      selfName: 'Mara Quill',
      selfEmails: [],
      speakers: [],
    };

    expect(itemOwner('Studio', grouped)).toEqual({ kind: 'unknown' });
  });

  describe('where the owner’s addresses come from', () => {
    /** Two Person notes at the owner's note's address: matching alone cannot tell them apart. */
    const twoNotes = {
      attendees: [{ name: 'mq', email: MARA, group: false }],
      people: [person('Mara Quill', { emails: [MARA] }), person('M Quill', { emails: [MARA] })],
      selfName: 'Mara Quill',
      speakers: [],
    };

    it('reads the owner’s Person note’s addresses as theirs while selfEmails holds none', () => {
      expect(itemOwner('mq', { ...twoNotes, selfEmails: [] })).toEqual({ kind: 'self' });
    });

    it('reads only selfEmails once it holds any: the Person note’s addresses no longer count', () => {
      expect(itemOwner('mq', { ...twoNotes, selfEmails: ['mq@example.org'] })).toMatchObject({
        kind: 'ambiguous',
      });
    });
  });
});

describe('itemOwner, with the transcript’s speakers: a guest who shares the owner’s first name', () => {
  const MARA_LIND = person('Mara Lind', {
    emails: ['mara.lind@vendor.example'],
    aliases: ['Mara'],
  });
  const spoken = (...speakers: string[]): OwnerDirectory => ({ ...OWNED, speakers });

  it('reads a one-word label beside the owner’s “You” as someone else, not the owner', () => {
    expect(itemOwner('Mara', spoken('You', 'Mara', 'Tobias Fenn'))).toEqual({
      kind: 'named',
      name: 'Mara',
      inMeeting: true,
    });
  });

  it('reads it as someone else once the owner’s name is a label too, as their attendee entry spells it', () => {
    const byAddress: OwnerDirectory = {
      ...spoken('Quill, Mara', 'Mara', 'Tobias Fenn'),
      attendees: [{ name: 'Quill, Mara', email: 'mara.quill@example.com', group: false }],
      people: [TOBIAS],
      selfName: null,
      selfEmails: ['mara.quill@example.com'],
    };

    expect(itemOwner('Mara', byAddress)).toMatchObject({ kind: 'named', name: 'Mara' });
    expect(itemOwner('Quill, Mara', byAddress)).toEqual({ kind: 'self' });
  });

  it('still reads the owner’s first name as theirs when the transcript has no other label for them', () => {
    expect(itemOwner('Mara', spoken('Mara', 'Tobias Fenn'))).toEqual({ kind: 'self' });
  });

  it.each([
    ['beside the owner’s own label', ['Mara Quill', 'Mara Lind', 'Tobias Fenn']],
    ['with no label for the owner', ['Mara Lind', 'Tobias Fenn']],
  ])('does not guess the owner for a first name another speaker has (%s)', (_, speakers) => {
    expect(itemOwner('Mara', spoken(...speakers))).toEqual({
      kind: 'ambiguous',
      name: 'Mara',
      candidates: ['Mara Quill', 'Mara Lind'],
    });
  });

  it('reads the first name as the Person note that has it as an alias before the owner’s first name', () => {
    const aliased = { ...spoken(), people: [...OWNED.people, MARA_LIND] };

    expect(itemOwner('Mara', aliased)).toEqual({
      kind: 'person',
      name: 'Mara Lind',
      person: MARA_LIND,
    });
  });

  it('reads the first name as the owner when the alias is on the owner’s own note', () => {
    const own = person('Mara Quill', { emails: ['mara.quill@example.com'], aliases: ['Mara'] });

    expect(itemOwner('Mara', { ...spoken(), people: [own, TOBIAS] })).toEqual({ kind: 'self' });
  });

  it('reads a first-name-only profile as the owner, but not a label of that name beside “You”', () => {
    const firstOnly: OwnerDirectory = {
      ...spoken('You', 'Mara'),
      selfName: 'Mara',
      selfEmails: ['mara.quill@example.com'],
    };

    expect(itemOwner('Mara', firstOnly)).toMatchObject({ kind: 'named', name: 'Mara' });
    expect(itemOwner('You', firstOnly)).toEqual({ kind: 'self' });
    expect(itemOwner('Mara', { ...firstOnly, speakers: ['Mara', 'Tobias Fenn'] })).toEqual({
      kind: 'self',
    });
  });

  it('never counts a speaker the provider could not name', () => {
    expect(itemOwner('Mara', spoken('You', 'Speaker 2', 'Unknown'))).toEqual({ kind: 'self' });
  });
});
