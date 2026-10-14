import { describe, expect, it } from 'vitest';
import { isOwnerAttendee } from './vault-owner.ts';

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
