import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import { vocabularyKey } from '../terms/spelling.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** A person in the vault, as matching reads their note. */
export interface DirectoryPerson {
  readonly path: VaultPath;
  /** Their note's title. */
  readonly name: string;
  /** `email` and every item of `other_emails`, as written. */
  readonly emails: readonly string[];
  readonly aliases: readonly string[];
  /** The company their note's `company` links, resolved; null when it links none. */
  readonly company: VaultPath | null;
}

/** A company in the vault, as matching reads its note. */
export interface DirectoryCompany {
  readonly path: VaultPath;
  readonly name: string;
  readonly aliases: readonly string[];
  /** Every item of `domains`, and the host of `site`, as written. */
  readonly domains: readonly string[];
}

/** How an attendee was found among the people. */
export type MatchedBy = 'email' | 'name' | 'alias';

export interface LinkedAttendee {
  readonly attendee: MeetingAttendee;
  readonly person: DirectoryPerson;
  readonly by: MatchedBy;
}

/** An attendee more than one person could be: proposed, never guessed. */
export interface AmbiguousAttendee {
  readonly attendee: MeetingAttendee;
  readonly candidates: readonly DirectoryPerson[];
  readonly by: MatchedBy;
}

/** An attendee no person matches, with the company their address surely belongs to, if any. */
export interface UnknownAttendee {
  readonly attendee: MeetingAttendee;
  readonly company: DirectoryCompany | null;
}

/** A company the meeting surely involves, and why. */
export interface MatchedCompany {
  readonly company: DirectoryCompany;
  /** An attendee's address is at its domain, or a linked person's note names it. */
  readonly by: 'domain' | 'person';
}

export interface AttendeeMatching {
  /** One per person, in the order they were first listed. */
  readonly linked: readonly LinkedAttendee[];
  readonly unknown: readonly UnknownAttendee[];
  /** Group addresses: kept, never a person (ADR-0027). */
  readonly groups: readonly MeetingAttendee[];
  readonly ambiguous: readonly AmbiguousAttendee[];
  readonly companies: readonly MatchedCompany[];
}

/**
 * Who a meeting's attendees are among the vault's people and companies
 * (P29-04). An attendee is matched by email first — `email` or any of
 * `other_emails`, case aside — and only when their address matches nobody, by
 * name: a person's name or one of their aliases, spelt the way the Terms page
 * compares spellings (composed, single-spaced, case folded). Exactly one
 * person is a link; two or more are ambiguous, which is proposed rather than
 * guessed; none is unknown. A group address is never a person.
 *
 * A company is involved when an attendee's address — a group's too — is at
 * its domain, or at a domain whose name is the company's name or alias
 * (`larkspur.example` for "Larkspur"); and when a linked person's note names
 * their company. Two companies claiming one domain claim nothing.
 */
export function matchAttendees(
  attendees: readonly MeetingAttendee[],
  people: readonly DirectoryPerson[],
  companies: readonly DirectoryCompany[],
): AttendeeMatching {
  const findPerson = personFinder(people);
  const companyOf = companyFinder(companies);
  const linked = new Map<VaultPath, LinkedAttendee>();
  const unknown: UnknownAttendee[] = [];
  const ambiguous: AmbiguousAttendee[] = [];
  const heard = new Set<string>();
  // Listed once with an address and once without, they are one person: the address is kept.
  const addressed = new Set(
    attendees.flatMap((each) => (each.email === null ? [] : [vocabularyKey(each.name)])),
  );
  for (const attendee of attendees) {
    const key = attendeeKey(attendee);
    if (attendee.group || heard.has(key)) continue;
    if (attendee.email === null && addressed.has(vocabularyKey(attendee.name))) continue;
    heard.add(key);
    const found = findPerson(attendee);
    const [person, ...others] = found?.candidates ?? [];
    if (found === null || person === undefined) {
      unknown.push({ attendee, company: companyOf(attendee.email) });
    } else if (others.length > 0) {
      ambiguous.push({ attendee, ...found });
    } else if (!linked.has(person.path)) {
      linked.set(person.path, { attendee, person, by: found.by });
    }
  }
  return {
    linked: [...linked.values()],
    unknown,
    groups: attendees.filter((attendee) => attendee.group),
    ambiguous,
    companies: involvedCompanies({ attendees, linked: [...linked.values()], companies, companyOf }),
  };
}

/**
 * The people named speakers surely are: a speaker's name, or alias, that
 * exactly one person has. One that matches nobody, or several, is left: a
 * speaker has no address to tell them apart, and the attendees are what
 * proposals are made from.
 */
export function matchSpeakers(
  names: readonly string[],
  people: readonly DirectoryPerson[],
): DirectoryPerson[] {
  const byName = nameIndex(people);
  const found = new Map<VaultPath, DirectoryPerson>();
  for (const name of names) {
    const [only, ...others] = byName.get(vocabularyKey(name)) ?? [];
    if (only !== undefined && others.length === 0) found.set(only.person.path, only.person);
  }
  return [...found.values()];
}

/** The part of an address after its last `@`, lower-cased; null for no address or no domain. */
export function emailDomain(email: string | null): string | null {
  if (email === null) return null;
  const at = email.lastIndexOf('@');
  const domain = hostKey(email.slice(at + 1));
  return at < 0 || domain === '' ? null : domain;
}

/**
 * Addresses anyone can have: being at one says nothing about a company, so a
 * company's name is never guessed from them.
 */
const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'aol.com',
  'fastmail.com',
  'gmail.com',
  'gmx.com',
  'googlemail.com',
  'hey.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
]);

/**
 * Hosts a company's site may be on that are not its own — a profile page on
 * one is no claim to everyone with an address there.
 */
const SHARED_HOSTS: ReadonlySet<string> = new Set([
  'facebook.com',
  'github.com',
  'instagram.com',
  'linkedin.com',
  'medium.com',
  'notion.site',
  'sites.google.com',
  'twitter.com',
  'x.com',
]);

/** Whether a domain or site a company names is its own, rather than anyone's. */
function ownDomain(written: string): boolean {
  const host = hostKey(written);
  return !PUBLIC_MAIL_DOMAINS.has(host) && !SHARED_HOSTS.has(host);
}

/** Second-level labels under a country's domain: `larkspur` in `larkspur.co.uk`, not `co`. */
const SHARED_SECOND_LEVELS: ReadonlySet<string> = new Set(['ac', 'co', 'com', 'gov', 'net', 'org']);

interface PersonFound {
  readonly candidates: readonly DirectoryPerson[];
  readonly by: MatchedBy;
}

interface NamedPerson {
  readonly person: DirectoryPerson;
  readonly by: 'name' | 'alias';
}

function personFinder(people: readonly DirectoryPerson[]) {
  const byEmail = new Map<string, DirectoryPerson[]>();
  for (const person of people) {
    for (const email of new Set(person.emails.map(emailKey).filter((key) => key !== ''))) {
      byEmail.set(email, [...(byEmail.get(email) ?? []), person]);
    }
  }
  const byName = nameIndex(people);
  return (attendee: MeetingAttendee): PersonFound | null => {
    const mailed = attendee.email === null ? [] : (byEmail.get(emailKey(attendee.email)) ?? []);
    if (mailed.length > 0) return { candidates: mailed, by: 'email' };
    const named = byName.get(vocabularyKey(attendee.name)) ?? [];
    if (named.length === 0) return null;
    return {
      candidates: named.map(({ person }) => person),
      by: named.every(({ by }) => by === 'alias') ? 'alias' : 'name',
    };
  };
}

/** Each spelling — a name or an alias — and the people it names, each person once. */
function nameIndex(people: readonly DirectoryPerson[]): Map<string, NamedPerson[]> {
  const byName = new Map<string, NamedPerson[]>();
  const add = (form: string, named: NamedPerson) => {
    const key = vocabularyKey(form);
    const known = byName.get(key) ?? [];
    if (key === '' || known.some(({ person }) => person.path === named.person.path)) return;
    byName.set(key, [...known, named]);
  };
  for (const person of people) {
    add(person.name, { person, by: 'name' });
    for (const alias of person.aliases) add(alias, { person, by: 'alias' });
  }
  return byName;
}

/** The company an address is surely at, or null: none, or more than one. */
function companyFinder(companies: readonly DirectoryCompany[]) {
  return (email: string | null): DirectoryCompany | null => {
    const domain = emailDomain(email);
    if (domain === null) return null;
    const declared = companies.filter((company) =>
      company.domains.some(
        (written) => ownDomain(written) && withinDomain(domain, hostKey(written)),
      ),
    );
    if (declared.length > 0) return onlyOne(declared);
    if (PUBLIC_MAIL_DOMAINS.has(domain)) return null;
    const label = compact(organisationLabel(domain));
    const named = companies.filter((company) =>
      [company.name, ...company.aliases].some((form) => label !== '' && compact(form) === label),
    );
    return onlyOne(named);
  };
}

function onlyOne<T>(found: readonly T[]): T | null {
  return found.length === 1 ? (found[0] ?? null) : null;
}

function involvedCompanies({
  attendees,
  linked,
  companies,
  companyOf,
}: {
  attendees: readonly MeetingAttendee[];
  linked: readonly LinkedAttendee[];
  companies: readonly DirectoryCompany[];
  companyOf: (email: string | null) => DirectoryCompany | null;
}): MatchedCompany[] {
  const involved = new Map<VaultPath, MatchedCompany>();
  for (const { email } of attendees) {
    const company = companyOf(email);
    if (company !== null && !involved.has(company.path)) {
      involved.set(company.path, { company, by: 'domain' });
    }
  }
  for (const { person } of linked) {
    const company = companies.find((candidate) => candidate.path === person.company);
    if (company !== undefined && !involved.has(company.path)) {
      involved.set(company.path, { company, by: 'person' });
    }
  }
  return [...involved.values()];
}

/**
 * What makes two attendee entries one attendee: their address, or their name
 * when they have none. What a proposal for them is known by, too.
 */
export function attendeeKey(attendee: MeetingAttendee): string {
  return attendee.email === null
    ? `name:${vocabularyKey(attendee.name)}`
    : `email:${emailKey(attendee.email)}`;
}

/** An address as compared: the part in `<…>` when written as a mail client copies it, case folded. */
function emailKey(email: string): string {
  const bracketed = /<([^<>]+)>\s*$/.exec(email)?.[1] ?? email;
  return bracketed.normalize('NFC').trim().toLowerCase();
}

/** A domain as written in a note or an address: `@`, `www.`, a scheme, a path and a final dot dropped. */
function hostKey(written: string): string {
  return written
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d*$/, '')
    .replace(/^@/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

/** Whether an address's domain is the company's, or one under it (`mail.larkspur.example`). */
function withinDomain(domain: string, companyDomain: string): boolean {
  return companyDomain !== '' && (domain === companyDomain || domain.endsWith(`.${companyDomain}`));
}

/** The label naming the organisation in a domain: `larkspur` in `mail.larkspur.example`. */
function organisationLabel(domain: string): string {
  const [top = '', second = '', third = ''] = domain.split('.').reverse();
  if (second === '') return top;
  const shared = third !== '' && top.length === 2 && SHARED_SECOND_LEVELS.has(second);
  return shared ? third : second;
}

/** A name with nothing but its letters and digits, to compare with a domain's label. */
function compact(form: string): string {
  return vocabularyKey(form).replace(/[^\p{L}\p{N}]/gu, '');
}
