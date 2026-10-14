import { describe, expect, it } from 'vitest';
import {
  GRANOLA_SELF_EMAILS_KEY,
  parseSelfEmails,
  SELF_EMAILS_KEY,
  selfEmailsFromText,
  selfEmailsSettingsChanges,
} from './self-emails.ts';

/** #173, ADR-0036 and the ADR-0024 amendment: the owner's addresses are one vault setting. */

describe('parseSelfEmails', () => {
  it('keys are the ones the vault’s settings note spells', () => {
    expect([SELF_EMAILS_KEY, GRANOLA_SELF_EMAILS_KEY]).toEqual([
      'selfEmails',
      'granola_self_emails',
    ]);
  });

  it('reads no addresses, from nowhere, when neither setting is there', () => {
    expect(parseSelfEmails({})).toEqual({ emails: [], source: null, problem: null });
    expect(parseSelfEmails({ profileName: 'Mara Quill' })).toEqual({
      emails: [],
      source: null,
      problem: null,
    });
  });

  it('reads selfEmails as the strict reader does: lower case, each once, in order', () => {
    expect(
      parseSelfEmails({
        [SELF_EMAILS_KEY]: ['Mara.Quill@example.com', 'mq@example.org', 'mara.quill@example.com'],
      }),
    ).toEqual({
      emails: ['mara.quill@example.com', 'mq@example.org'],
      source: 'selfEmails',
      problem: null,
    });
    expect(
      parseSelfEmails({ [SELF_EMAILS_KEY]: 'Mara Quill <mara.quill@example.com>; mq@example.org' }),
    ).toEqual({
      emails: ['mara.quill@example.com', 'mq@example.org'],
      source: 'selfEmails',
      problem: null,
    });
  });

  it('reads granola_self_emails as an alias while selfEmails is not there', () => {
    expect(parseSelfEmails({ [GRANOLA_SELF_EMAILS_KEY]: ['mara.quill@example.com'] })).toEqual({
      emails: ['mara.quill@example.com'],
      source: 'granola_self_emails',
      problem: null,
    });
  });

  it.each([
    ['null', null],
    ['an empty list', []],
    ['blank text', '  '],
    ['a list of blanks', ['', null]],
  ])('reads the alias while selfEmails is %s', (_, empty) => {
    expect(
      parseSelfEmails({
        [SELF_EMAILS_KEY]: empty,
        [GRANOLA_SELF_EMAILS_KEY]: ['mara.quill@example.com'],
      }),
    ).toEqual({ emails: ['mara.quill@example.com'], source: 'granola_self_emails', problem: null });
  });

  it('reads selfEmails alone when both are set: the alias is never mixed in', () => {
    expect(
      parseSelfEmails({
        [SELF_EMAILS_KEY]: ['mara.quill@example.com'],
        [GRANOLA_SELF_EMAILS_KEY]: ['old.address@example.com'],
      }),
    ).toEqual({ emails: ['mara.quill@example.com'], source: 'selfEmails', problem: null });
  });

  it('when both are set, an alias that cannot be read is not a problem: it is not read', () => {
    expect(
      parseSelfEmails({
        [SELF_EMAILS_KEY]: ['mara.quill@example.com'],
        [GRANOLA_SELF_EMAILS_KEY]: 'mara.quill@example.com, Mara',
      }),
    ).toEqual({ emails: ['mara.quill@example.com'], source: 'selfEmails', problem: null });
  });

  it('guesses nothing from an unreadable selfEmails: no address, not the alias’s either, and why', () => {
    expect(
      parseSelfEmails({
        [SELF_EMAILS_KEY]: 'mara.quill@example.com, Mara',
        [GRANOLA_SELF_EMAILS_KEY]: ['mara.quill@example.com'],
      }),
    ).toEqual({ emails: [], source: 'selfEmails', problem: 'Not an email address: “Mara”.' });
    expect(parseSelfEmails({ [SELF_EMAILS_KEY]: 7 })).toEqual({
      emails: [],
      source: 'selfEmails',
      problem: 'It is not a list of email addresses.',
    });
    expect(parseSelfEmails({ [SELF_EMAILS_KEY]: [{ email: 'mara@example.com' }] })).toEqual({
      emails: [],
      source: 'selfEmails',
      problem: 'Not an email address: “a nested value”.',
    });
  });

  it('says why an alias that is read could not be, and reads no address', () => {
    expect(parseSelfEmails({ [GRANOLA_SELF_EMAILS_KEY]: 'mara.quill@example.com, Mara' })).toEqual(
      { emails: [], source: 'granola_self_emails', problem: 'Not an email address: “Mara”.' },
    );
  });

  it('refuses an address with an invisible character in it rather than cleaning it into another', () => {
    expect(parseSelfEmails({ [SELF_EMAILS_KEY]: ['mara.quill@exa​mple.com'] })).toMatchObject({
      emails: [],
      problem: 'Not an email address: “mara.quill@exa\\u200Bmple.com”.',
    });
  });

  it('never makes an address out of a name, a username or a path', () => {
    for (const settings of [
      { profileName: 'Mara Quill' },
      { [SELF_EMAILS_KEY]: 'mquill' },
      { [SELF_EMAILS_KEY]: ['/Users/mquill'] },
    ]) {
      expect(parseSelfEmails(settings).emails).toEqual([]);
    }
  });
});

describe('selfEmailsFromText', () => {
  it('reads what is typed as the strict reader does', () => {
    expect(selfEmailsFromText('Mara Quill <Mara.Quill@example.com>\nmq@example.org')).toEqual({
      ok: true,
      emails: ['mara.quill@example.com', 'mq@example.org'],
    });
    expect(selfEmailsFromText('  ')).toEqual({ ok: true, emails: [] });
  });

  it('names what is not an address, and says nothing was saved', () => {
    expect(selfEmailsFromText('mara.quill@example.com and Mara')).toEqual({
      ok: false,
      problem: 'Not an email address: “and”, “Mara”. Nothing was saved.',
    });
  });
});

describe('selfEmailsSettingsChanges', () => {
  it('writes the addresses under selfEmails alone, never the alias', () => {
    expect(selfEmailsSettingsChanges(['mara.quill@example.com'])).toEqual({
      selfEmails: ['mara.quill@example.com'],
    });
  });

  it('removes the key for none, rather than writing an empty list', () => {
    expect(selfEmailsSettingsChanges([])).toEqual({ selfEmails: null });
  });
});
