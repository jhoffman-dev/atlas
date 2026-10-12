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
      kind: 'named',
      name: 'Tobias',
      several: false,
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
      several: false,
    });
    expect(itemOwner('platform-team', DIRECTORY)).toEqual({
      kind: 'named',
      name: 'platform-team',
      several: false,
    });
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
      kind: 'named',
      name: 'Ines Okafor',
      several: true,
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
      several: false,
    });
    expect(itemOwner('Mara Quill', { ...unnamed, attendees: [] })).toMatchObject({
      kind: 'person',
      name: 'Mara Quill',
    });
  });
});
