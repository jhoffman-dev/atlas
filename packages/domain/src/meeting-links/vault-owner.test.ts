import { describe, expect, it } from 'vitest';
import { comparableAddress } from '../profile/email-addresses.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  isOwnerAttendee,
  ownerAddresses,
  ownerAddressesInUse,
  ownerNotAGroup,
} from './vault-owner.ts';

/** #173: an attendee is the vault's owner by the profile's name or by the vault's `selfEmails`. */
describe('isOwnerAttendee', () => {
  const attendee = (name: string, email: string | null) => ({ name, email, group: false });

  it('is the owner by an address alone, whatever name the attendee shows', () => {
    expect(
      isOwnerAttendee({
        attendee: attendee('mq', 'mara.quill@example.com'),
        selfName: null,
        selfEmails: ['mara.quill@example.com'],
      }),
    ).toBe(true);
  });

  it('compares addresses as a mail client writes them: case, spaces and `Name <address>`', () => {
    expect(
      isOwnerAttendee({
        attendee: attendee('mq', ' Mara Quill <MARA.Quill@Example.com> '),
        selfName: null,
        selfEmails: ['mara.quill@example.com'],
      }),
    ).toBe(true);
  });

  it('compares addresses in one Unicode form, however the setting was typed', () => {
    expect(
      isOwnerAttendee({
        attendee: attendee('ren', 'rén@example.com'),
        selfName: null,
        selfEmails: ['rén@example.com'],
      }),
    ).toBe(true);
    expect(
      isOwnerAttendee({
        attendee: attendee('ren', 'rén@example.com'),
        selfName: null,
        selfEmails: ['rén@example.com'],
      }),
    ).toBe(true);
  });

  it('is the owner by name alone, with no address set', () => {
    expect(
      isOwnerAttendee({
        attendee: attendee('Quill, Mara', null),
        selfName: 'Mara Quill',
        selfEmails: [],
      }),
    ).toBe(true);
  });

  it('is not the owner by neither: another name at another address', () => {
    expect(
      isOwnerAttendee({
        attendee: attendee('Tobias Fenn', 'tobias.fenn@example.com'),
        selfName: 'Mara Quill',
        selfEmails: ['mara.quill@example.com'],
      }),
    ).toBe(false);
    expect(
      isOwnerAttendee({
        attendee: attendee('mq', 'mara.quill@example.com'),
        selfName: null,
        selfEmails: [],
      }),
    ).toBe(false);
  });
});

/** #173 review: addresses compared in one form, their domains in ASCII. */
describe('comparableAddress', () => {
  it('reads a Unicode domain as its ASCII (punycode) form, and leaves an ASCII one as it is', () => {
    expect(comparableAddress('Mara@Bücher.Example')).toBe('mara@xn--bcher-kva.example');
    expect(comparableAddress('mara@xn--bcher-kva.example')).toBe('mara@xn--bcher-kva.example');
    expect(comparableAddress(' Mara.Quill@Example.com ')).toBe('mara.quill@example.com');
  });

  it('composes the address, so one typed decomposed is the one a meeting lists', () => {
    expect(comparableAddress('re\u0301n@example.com')).toBe('r\u00e9n@example.com');
  });

  it('leaves the local part as it is: only the domain has an ASCII form', () => {
    expect(comparableAddress('rén@bücher.example')).toBe('rén@xn--bcher-kva.example');
  });

  it('never reads a domain holding what a URL would take apart as another domain', () => {
    expect(comparableAddress('mara@bücher.example/evil.example')).toBe(
      'mara@bücher.example/evil.example',
    );
    expect(comparableAddress('mara@bücher.example:80')).toBe('mara@bücher.example:80');
    expect(comparableAddress('mara@bü\tcher.example')).toBe('mara@bü\tcher.example');
  });

  it('leaves a domain IDNA refuses as it is written', () => {
    expect(comparableAddress('mara@xn--a.bü')).toBe('mara@xn--a.bü');
  });

  it('leaves text with no @ as it is, case folded', () => {
    expect(comparableAddress('Mara')).toBe('mara');
  });
});

describe('isOwnerAttendee, across a domain’s two forms', () => {
  const attendee = (email: string) => ({ name: 'mq', email, group: false });

  it('is the owner whichever form either side holds', () => {
    for (const [listed, set] of [
      ['mara@xn--bcher-kva.example', 'mara@bücher.example'],
      ['mara@bücher.example', 'mara@xn--bcher-kva.example'],
    ] as const) {
      expect(
        isOwnerAttendee({ attendee: attendee(listed), selfName: null, selfEmails: [set] }),
      ).toBe(true);
    }
  });

  it('is not the owner at another domain', () => {
    expect(
      isOwnerAttendee({
        attendee: attendee('mara@xn--bcher-kva.example'),
        selfName: null,
        selfEmails: ['mara@bucher.example'],
      }),
    ).toBe(false);
  });
});

describe('ownerAddressesInUse', () => {
  const owner = {
    path: createVaultPath('People/Mara Quill.md'),
    name: 'Mara Quill',
    emails: ['Mara.Quill@example.com'],
    aliases: [],
    company: null,
  };

  it('is the vault’s selfEmails alone once it holds any', () => {
    expect(
      ownerAddressesInUse({
        selfEmails: ['mq@example.org'],
        people: [owner],
        selfName: 'Mara Quill',
      }),
    ).toEqual(['mq@example.org']);
  });

  it('is the owner’s Person note’s addresses while selfEmails holds none', () => {
    expect(
      ownerAddressesInUse({ selfEmails: [], people: [owner], selfName: 'Mara Quill' }),
    ).toEqual(['mara.quill@example.com']);
    expect(ownerAddressesInUse({ selfEmails: [], people: [owner], selfName: null })).toEqual([]);
  });

  it('offers the Person note’s addresses as written, never in their ASCII form', () => {
    const unicode = { ...owner, emails: ['mara@bücher.example'] };
    expect(ownerAddresses([unicode], 'Mara Quill')).toEqual(['mara@bücher.example']);
  });
});

describe('ownerNotAGroup', () => {
  const team = { name: 'Studio', email: 'Team@Quill.example', group: true };
  const list = { name: 'All hands', email: 'all@quill.example', group: true };

  it('reads an attendee at one of selfEmails as a person, and leaves every other group a group', () => {
    expect(ownerNotAGroup([team, list], ['team@quill.example'])).toEqual([
      { ...team, group: false },
      list,
    ]);
  });

  it('changes nothing with no selfEmails', () => {
    const attendees = [team, list];
    expect(ownerNotAGroup(attendees, [])).toBe(attendees);
  });
});
