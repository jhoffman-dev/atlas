import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  emailDomain,
  matchAttendees,
  matchSpeakers,
  type DirectoryCompany,
  type DirectoryPerson,
} from './attendee-matching.ts';

const person = (name: string, more: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  emails: [],
  aliases: [],
  company: null,
  ...more,
});

const company = (name: string, more: Partial<DirectoryCompany> = {}): DirectoryCompany => ({
  path: createVaultPath(`Companies/${name}.md`),
  name,
  aliases: [],
  domains: [],
  ...more,
});

const attendee = (name: string, email: string | null = null, group = false): MeetingAttendee => ({
  name,
  email,
  group,
});

const MARA = person('Mara Quill', {
  emails: ['mara@larkspur.example'],
  aliases: ['Mara Quil'],
  company: createVaultPath('Companies/Larkspur Payroll.md'),
});
const TOBIAS = person('Tobias Fenn', { emails: ['tobias@fenn.example'], aliases: ['Toby'] });
const LARKSPUR = company('Larkspur Payroll', {
  aliases: ['Larkspur'],
  domains: ['larkspur.example'],
});
const FENN = company('Fenn & Co', { aliases: ['Fenn'] });

const pathsOf = (people: readonly { person: DirectoryPerson }[]) =>
  people.map(({ person: { path } }) => path);

describe('matchAttendees', () => {
  it('links an attendee whose email matches a person, with no proposal', () => {
    const matching = matchAttendees(
      [attendee('M. Quill', 'mara@larkspur.example')],
      [MARA, TOBIAS],
      [],
    );
    expect(matching.linked).toEqual([
      { attendee: attendee('M. Quill', 'mara@larkspur.example'), person: MARA, by: 'email' },
    ]);
    expect(matching.unknown).toEqual([]);
    expect(matching.ambiguous).toEqual([]);
  });

  it('matches an email in any case, and one of a person’s other emails', () => {
    const both = person('Ivo Brandt', { emails: ['ivo@work.example', 'Ivo.Brandt@Home.example'] });
    const matching = matchAttendees([attendee('Ivo', ' IVO.BRANDT@home.EXAMPLE ')], [both], []);
    expect(pathsOf(matching.linked)).toEqual([both.path]);
    expect(matching.linked[0]?.by).toBe('email');
  });

  it('prefers the email to the name: an address is who they are', () => {
    const matching = matchAttendees(
      [attendee('Tobias Fenn', 'mara@larkspur.example')],
      [MARA, TOBIAS],
      [],
    );
    expect(pathsOf(matching.linked)).toEqual([MARA.path]);
  });

  it('links by name, then by alias, folding case, spacing and Unicode composition', () => {
    const zoe = person('Zoë Ardent');
    const decomposed = 'Zoë   ARDENT';
    const matching = matchAttendees(
      [attendee(decomposed, 'zoe@nowhere.example'), attendee('toby')],
      [zoe, TOBIAS],
      [],
    );
    expect(matching.linked.map(({ person: { name }, by }) => [name, by])).toEqual([
      ['Zoë Ardent', 'name'],
      ['Tobias Fenn', 'alias'],
    ]);
  });

  it('proposes rather than guesses when two people share an alias', () => {
    const tobiasLin = person('Tobias Lin', { aliases: ['Toby'] });
    const matching = matchAttendees([attendee('Toby')], [TOBIAS, tobiasLin], []);
    expect(matching.linked).toEqual([]);
    expect(matching.ambiguous).toEqual([
      { attendee: attendee('Toby'), candidates: [TOBIAS, tobiasLin], by: 'alias' },
    ]);
  });

  it('proposes rather than guesses when a name is one person’s and another’s alias', () => {
    const sam = person('Sam Ode');
    const other = person('Samuel Ode', { aliases: ['Sam Ode'] });
    const matching = matchAttendees([attendee('Sam Ode')], [sam, other], []);
    expect(matching.ambiguous[0]?.candidates).toEqual([sam, other]);
    expect(matching.ambiguous[0]?.by).toBe('name');
  });

  it('proposes rather than guesses when two people have one address', () => {
    const shared = person('Desk Two', { emails: ['mara@larkspur.example'] });
    const matching = matchAttendees(
      [attendee('Mara', 'mara@larkspur.example')],
      [MARA, shared],
      [],
    );
    expect(matching.ambiguous[0]?.candidates).toEqual([MARA, shared]);
    expect(matching.ambiguous[0]?.by).toBe('email');
  });

  it('never makes a group address a person, even one whose name matches someone', () => {
    const team = attendee('Mara Quill', 'payroll-team@larkspur.example', true);
    const matching = matchAttendees([team], [MARA], [LARKSPUR]);
    expect(matching.groups).toEqual([team]);
    expect(matching.linked).toEqual([]);
    expect(matching.unknown).toEqual([]);
    expect(matching.ambiguous).toEqual([]);
  });

  it('keeps an unknown attendee with the company their address is surely at', () => {
    const matching = matchAttendees(
      [attendee('Ada Venn', 'ada@mail.larkspur.example'), attendee('Odile', null)],
      [MARA],
      [LARKSPUR],
    );
    expect(matching.unknown).toEqual([
      { attendee: attendee('Ada Venn', 'ada@mail.larkspur.example'), company: LARKSPUR },
      { attendee: attendee('Odile', null), company: null },
    ]);
  });

  it('hears the same attendee once, by address or by name', () => {
    const matching = matchAttendees(
      [
        attendee('Ada', 'ada@x.example'),
        attendee('Ada Venn', 'ADA@x.example'),
        attendee('Odile'),
        attendee('odile'),
        attendee('Mara', 'mara@larkspur.example'),
        attendee('Mara Quill'),
      ],
      [MARA],
      [],
    );
    expect(matching.unknown.map(({ attendee: { name } }) => name)).toEqual(['Ada', 'Odile']);
    expect(pathsOf(matching.linked)).toEqual([MARA.path]);
  });

  it('involves a company by a domain it declares, or under it, its site’s host, and a linked person’s note', () => {
    const quarry = company('Quarry', { domains: ['https://www.qx-mail.example/about'] });
    const matching = matchAttendees(
      [attendee('Ada', 'ada@eu.qx-mail.example'), attendee('Mara Quill')],
      [MARA],
      [LARKSPUR, quarry],
    );
    expect(matching.companies.map(({ company: { name }, by }) => [name, by])).toEqual([
      ['Quarry', 'domain'],
      ['Larkspur Payroll', 'person'],
    ]);
  });

  it('involves a company whose name or alias is the domain’s organisation, never a public mail domain', () => {
    const matching = matchAttendees(
      [
        attendee('Ada', 'ada@fenn.example'),
        attendee('Bo', 'bo@larkspur.co.uk'),
        attendee('Cy', 'cy@gmail.com'),
      ],
      [],
      [FENN, company('Gmail'), company('Larkspur UK', { aliases: ['Lark-spur'] })],
    );
    expect(matching.companies.map(({ company: { name } }) => name)).toEqual([
      'Fenn & Co',
      'Larkspur UK',
    ]);
    expect(matching.unknown.map(({ company: found }) => found?.name ?? null)).toEqual([
      'Fenn & Co',
      'Larkspur UK',
      null,
    ]);
  });

  it('counts a group’s address toward its company', () => {
    const matching = matchAttendees(
      [attendee('Payroll', 'team@larkspur.example', true)],
      [],
      [LARKSPUR],
    );
    expect(matching.companies.map(({ company: { path } }) => path)).toEqual([LARKSPUR.path]);
  });

  it('claims nothing when two companies claim one domain', () => {
    const twin = company('Larkspur Holdings', { domains: ['@LARKSPUR.example.'] });
    const matching = matchAttendees(
      [attendee('Ada', 'ada@larkspur.example')],
      [],
      [LARKSPUR, twin],
    );
    expect(matching.companies).toEqual([]);
    expect(matching.unknown[0]?.company).toBeNull();
  });

  it('never claims everyone at a shared host or public mail domain a company names', () => {
    const profiled = company('Quarry', {
      domains: ['https://www.linkedin.com/company/quarry', 'gmail.com'],
    });
    const matching = matchAttendees(
      [attendee('Ada', 'ada@linkedin.com'), attendee('Bo', 'bo@gmail.com')],
      [],
      [profiled],
    );
    expect(matching.companies).toEqual([]);
  });

  it('does not match a domain that only ends like a company’s', () => {
    const matching = matchAttendees([attendee('Ada', 'ada@notlarkspur.example')], [], [LARKSPUR]);
    expect(matching.companies).toEqual([]);
  });
});

describe('matchSpeakers', () => {
  it('links a speaker who is exactly one person, by name or alias, and leaves the rest', () => {
    const tobiasLin = person('Tobias Lin', { aliases: ['Tobi'] });
    const found = matchSpeakers(
      ['mara quill', 'Toby', 'Toby', 'Nobody Known', 'Tobi', ''],
      [MARA, TOBIAS, tobiasLin, person('Tobi Other', { aliases: ['Tobi'] })],
    );
    expect(found.map(({ name }) => name)).toEqual(['Mara Quill', 'Tobias Fenn']);
  });
});

describe('emailDomain', () => {
  it('is what follows the last @, tidied, or null', () => {
    expect(emailDomain('"a@b"@Larkspur.Example.')).toBe('larkspur.example');
    expect(emailDomain('no-domain@')).toBeNull();
    expect(emailDomain('plain')).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });
});
