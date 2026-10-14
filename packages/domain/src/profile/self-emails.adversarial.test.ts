import { describe, expect, it } from 'vitest';
import { itemOwner } from '../automations/meeting-item-owner.ts';
import { parseGranolaSettings } from '../granola/granola-settings.ts';
import { isOwnerAttendee } from '../meeting-links/vault-owner.ts';
import { mapGranolaNote } from '../meetings/mapping/granola-note.ts';
import { parseSelfEmails, selfEmailsFromText } from './self-emails.ts';

/**
 * Adversarial (#173): `selfEmails` is one setting every consumer reads, so
 * every consumer must agree on who the owner is for the same setting and the
 * same address.
 */

/** `rén@example.com` with the é decomposed (NFD), as a copy from a file name or some editors gives it. */
const REN_NFD = 'rén@example.com';
/** The same address composed (NFC), as Granola and calendars send it. */
const REN_NFC = 'rén@example.com';

function granolaNoteOwnedBy(email: string) {
  return {
    id: 'not_adv173aaaaaaa1',
    object: 'note',
    title: 'Ledger sync',
    owner: { name: 'Ren Halloway', email },
    created_at: '2026-10-06T16:58:00Z',
    updated_at: '2026-10-06T18:00:00Z',
    deleted_at: null,
    web_url: 'https://notes.granola.ai/d/not_adv173aaaaaaa1',
    calendar_event: null,
    attendees: [
      { name: 'Ren Halloway', email },
      { name: 'Tobias Fenn', email: 'tobias.fenn@example.com' },
    ],
    folder_membership: [],
    summary_text: 'Ledger sync.',
    summary_markdown: null,
    private_notes_text: null,
    private_notes_markdown: null,
    transcript: [
      {
        text: 'Morning, Tobias.',
        start_time: '2026-10-06T17:00:00Z',
        end_time: '2026-10-06T17:00:00Z',
        speaker: { source: 'microphone', attribution: 'me' },
      },
    ],
  };
}

describe('the owner’s addresses, as every consumer of selfEmails reads them', () => {
  it('reads an NFD-typed address so that Granola’s `me` agrees with linking and item ownership', () => {
    // The Profile form keeps what is typed; typed decomposed, it is kept decomposed.
    const typed = selfEmailsFromText(REN_NFD);
    expect(typed.ok).toBe(true);
    const settings = { selfEmails: typed.ok ? typed.emails : [] };
    const { emails } = parseSelfEmails(settings);

    // Linking and item ownership compare in one Unicode form: the attendee is the owner.
    const attendee = { name: 'Ren Halloway', email: REN_NFC, group: false };
    expect(isOwnerAttendee({ attendee, selfName: null, selfEmails: emails })).toBe(true);
    expect(
      itemOwner('Ren Halloway', {
        attendees: [attendee],
        people: [],
        selfName: null,
        selfEmails: emails,
      }).kind,
    ).toBe('self');

    // Granola maps by the same setting: the owner's own note must write `me` as You.
    const { selfEmails, timeZone, groupAddresses } = parseGranolaSettings(settings);
    const mapped = mapGranolaNote(granolaNoteOwnedBy(REN_NFC), {
      timeZone,
      selfEmails,
      groupAddresses,
    }).content;
    expect(mapped).toContain('**You**');
  });

  it('compares a Unicode domain with its ASCII (punycode) form as one address', () => {
    // The reader accepts a Unicode domain; a calendar or Granola may send the ASCII form.
    const typed = selfEmailsFromText('mara@bücher.example');
    expect(typed.ok).toBe(true);
    const emails = typed.ok ? typed.emails : [];
    expect(
      isOwnerAttendee({
        attendee: { name: 'mq', email: 'mara@xn--bcher-kva.example', group: false },
        selfName: null,
        selfEmails: emails,
      }),
    ).toBe(true);
  });
});

describe('whose an item is, in a vault with neither selfEmails nor granola_self_emails', () => {
  const OWNER_ADDRESS = 'mara.quill@example.com';
  const person = (name: string) => ({
    path: `People/${name}.md` as never,
    name,
    emails: [OWNER_ADDRESS],
    aliases: [],
    company: null,
  });

  it('is still the owner’s when two Person notes hold the owner’s note’s address', () => {
    const owner = itemOwner('mq', {
      attendees: [{ name: 'mq', email: OWNER_ADDRESS, group: false }],
      people: [person('Mara Quill'), person('M Quill')],
      selfName: 'Mara Quill',
      selfEmails: [],
    });
    // Before #173 the owner's note's address made this the owner's task; now it is left "ambiguous".
    expect(owner.kind).toBe('self');
  });
});

describe('whose an item is, when the model ends the owner’s address with a full stop', () => {
  const directory = {
    attendees: [
      { name: 'Mara Quill', email: 'mara.quill@example.com', group: false },
      { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
    ],
    people: [],
    selfName: null,
    selfEmails: ['mara.quill@example.com'],
  };

  it('reads a bare address with a sentence’s full stop as the owner’s', () => {
    // tidyOwner strips the full stop from a name; an address is read before it is tidied.
    expect(itemOwner('mara.quill@example.com.', directory).kind).toBe('self');
  });

  it('reads `Name <address>.` as the owner’s', () => {
    expect(itemOwner('Mara Quill <mara.quill@example.com>.', directory).kind).toBe('self');
  });
});

describe('whose an item is, when the owner’s own address reads as a group', () => {
  // `team@` matches the group rule (GROUP_LOCAL_PART), so the mapper marks the owner's entry a group.
  const SELF = 'team@quillstudio.example';
  const directory = {
    attendees: [
      { name: 'Mara Quill', email: SELF, group: true },
      { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
    ],
    people: [],
    selfName: null,
    selfEmails: [SELF],
  };

  it('is the owner’s by name: the owner said that address is theirs', () => {
    expect(itemOwner('Mara Quill', directory).kind).toBe('self');
  });
});
