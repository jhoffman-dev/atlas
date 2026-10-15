import { linkTargets } from '../index/relation-rows.ts';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { TranscriptTurn } from '../meetings/transcript.ts';
import { resolveWikiLinkTarget, wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { newPersonRefusal, PEOPLE_FOLDER } from '../people/person.ts';
import type { NewProposal } from '../proposals/new-proposal.ts';
import { linkedNotes, withLink } from '../types/relation-links.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  attendeeKey,
  emailDomain,
  type AmbiguousAttendee,
  type AttendeeMatching,
  type GuessedCompany,
  type DirectoryPerson,
  type UnknownAttendee,
} from './attendee-matching.ts';
import {
  MEETING_COMPANIES_KEY,
  MEETING_LINKS_MAKER,
  MEETING_PEOPLE_KEY,
  MEETING_PROJECT_KEY,
} from './meeting-link-keys.ts';
import { projectConfidence, type RankedProject } from './project-ranking.ts';
import { isOwnerAttendee } from './vault-owner.ts';

/** What linking a meeting is worked out from. */
export interface MeetingLinkInput {
  readonly meeting: VaultPath;
  /** The meeting's frontmatter as it is now. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Every note in the vault, so each link is written to open the note it means. */
  readonly notePaths: readonly VaultPath[];
  readonly matching: AttendeeMatching;
  /** People the transcript's named speakers surely are. */
  readonly speakers: readonly DirectoryPerson[];
  /** The open projects its people and companies are tied to, likeliest first. */
  readonly projects: readonly RankedProject[];
  /** The vault owner's name, from their profile: never proposed as someone new. */
  readonly selfName: string | null;
  /** The vault owner's own addresses, the vault's `selfEmails`: an attendee at one is them. */
  readonly selfEmails?: readonly string[];
}

/** An unknown attendee who could not be proposed, and why. */
export interface PassedOverAttendee {
  readonly name: string;
  readonly reason: string;
}

export interface MeetingLinkPlan {
  /** Each relation of the meeting that gains a link, with its whole value after. */
  readonly changes: Readonly<Record<string, readonly string[]>>;
  /** The notes each relation in `changes` newly links. */
  readonly added: Readonly<Record<string, readonly VaultPath[]>>;
  readonly proposals: readonly NewProposal[];
  readonly passedOver: readonly PassedOverAttendee[];
  /** Relations it would have added to but left, holding something other than links, and why. */
  readonly unreadable: readonly { readonly key: string; readonly reason: string }[];
}

/**
 * The people and companies a meeting is surely tied to: those its attendees
 * and speakers are, and the companies they are at. What its likely project
 * is ranked by.
 */
export function linkedEntities(
  matching: AttendeeMatching,
  speakers: readonly DirectoryPerson[],
): VaultPath[] {
  const people = [...matching.linked.map(({ person }) => person), ...speakers].map(
    ({ path }) => path,
  );
  const companies = matching.companies.map(({ company }) => company.path);
  return [...new Set([...people, ...companies])];
}

/**
 * What linking a meeting does (P29-04). Sure matches — an attendee or a
 * speaker who is exactly one person, a company their address or note surely
 * names — are added to the meeting's `people` and `companies`; nothing there
 * is ever taken out or replaced, and a link to a note already linked however
 * it is spelt is not added again. Everything unsure is proposed, never
 * guessed: an unknown attendee as a new person (their name, address and the
 * company they are surely at), who joins the meeting when accepted; an
 * attendee several people could be as a link to each, to accept the right
 * one; and, when the meeting has no project, the likeliest open project. A
 * group address and the vault's owner are never proposed. A company only a
 * domain's name points at is proposed too, never written.
 *
 * A proposal is known by what it is for, not by where the meeting happens to
 * be: a person by their address alone (so rejecting them once covers every
 * later meeting), the rest by the meeting's provider and id — a meeting is
 * filed out of the Inbox, and its proposals are the same ones.
 */
export function planMeetingLinks(input: MeetingLinkInput): MeetingLinkPlan {
  const people = [
    ...input.matching.linked.map(({ person }) => person.path),
    ...input.speakers.map(({ path }) => path),
  ];
  const companies = input.matching.companies.map(({ company }) => company.path);
  const peopleNow = linkedPaths(input, MEETING_PEOPLE_KEY);
  const added = {
    [MEETING_PEOPLE_KEY]: newLinks(people, peopleNow),
    [MEETING_COMPANIES_KEY]: newLinks(companies, linkedPaths(input, MEETING_COMPANIES_KEY)),
  };
  const changes: Record<string, readonly string[]> = {};
  const gaining: Record<string, readonly VaultPath[]> = {};
  const unreadable: { key: string; reason: string }[] = [];
  for (const [key, paths] of Object.entries(added)) {
    if (paths.length === 0) continue;
    if (!holdsLinks(input.properties[key])) {
      unreadable.push({
        key,
        reason: `Its ${key} holds something other than links, so it was left as it is.`,
      });
      continue;
    }
    changes[key] = withLinks(input, key, paths);
    gaining[key] = paths;
  }
  const peopleAfter = new Set([...peopleNow, ...added[MEETING_PEOPLE_KEY]]);
  const proposing = proposalsFor(input, peopleAfter);
  return {
    changes,
    added: gaining,
    proposals: proposing.proposals,
    passedOver: proposing.passedOver,
    unreadable,
  };
}

/** Whether a relation's value is links Atlas can add to: none yet, one, or a list of them. */
function holdsLinks(value: unknown): boolean {
  if (value === undefined || value === null || typeof value === 'string') return true;
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The distinct people named as speakers of a transcript's turns, as written. */
export function namedSpeakers(turns: readonly TranscriptTurn[]): string[] {
  const names = turns.flatMap(({ speaker }) => (speaker.kind === 'named' ? [speaker.name] : []));
  return [...new Set(names)];
}

/**
 * A meeting's attendees as its frontmatter lists them, read leniently: an
 * imported meeting may since have been edited out of the contract, and its
 * attendees are still who was there. An entry without a name is skipped.
 */
export function attendeesOf(properties: Readonly<Record<string, unknown>>): MeetingAttendee[] {
  const listed = properties['attendees'];
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Readonly<Record<string, unknown>>;
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    const email = typeof record['email'] === 'string' ? record['email'].trim() : '';
    if (name === '') return [];
    return [{ name, email: email === '' ? null : email, group: record['group'] === true }];
  });
}

function proposalsFor(input: MeetingLinkInput, peopleAfter: ReadonlySet<VaultPath>) {
  const passedOver: PassedOverAttendee[] = [];
  const proposals: NewProposal[] = [];
  for (const unknown of input.matching.unknown) {
    if (isOwner(input, unknown.attendee)) continue;
    const refusal = newPersonRefusal(unknown.attendee.name);
    if (refusal === null) proposals.push(personProposal(input, unknown));
    else passedOver.push({ name: unknown.attendee.name, reason: refusal });
  }
  for (const ambiguous of input.matching.ambiguous) {
    // One of them is linked already — by a speaker, or by hand: that answers it.
    if (ambiguous.candidates.some(({ path }) => peopleAfter.has(path))) continue;
    if (isOwner(input, ambiguous.attendee)) continue;
    proposals.push(...ambiguousProposals(input, ambiguous));
  }
  proposals.push(...input.matching.guessedCompanies.map((guess) => companyProposal(input, guess)));
  const project = projectProposal(input);
  if (project !== null) proposals.push(project);
  return { proposals, passedOver };
}

/** Whether an attendee is the vault's owner, by their profile's name or the vault's `selfEmails`: never proposed. */
function isOwner(input: MeetingLinkInput, attendee: MeetingAttendee): boolean {
  return isOwnerAttendee({
    attendee,
    selfName: input.selfName,
    selfEmails: input.selfEmails ?? [],
  });
}

function personProposal(
  input: MeetingLinkInput,
  { attendee, company }: UnknownAttendee,
): NewProposal {
  const properties = {
    ...(attendee.email !== null && { email: attendee.email }),
    ...(company !== null && { company: linkTo(input, company.path) }),
  };
  const address = attendee.email === null ? '' : ` (${attendee.email})`;
  const at = company === null ? '' : `, at ${company.name},`;
  return {
    kind: 'person',
    confidence: attendee.email === null ? 'medium' : 'high',
    source: linkTo(input, input.meeting),
    madeBy: MEETING_LINKS_MAKER,
    id: personProposalId(attendee),
    name: `${attendee.name} — ${meetingTitle(input)}`,
    reason: `${attendee.name}${address}${at} was at this meeting and is not in People yet. Accepting makes them, and links them to the meeting.`,
    payload: {
      title: attendee.name,
      folder: PEOPLE_FOLDER,
      properties,
      body: '',
      linkFrom: {
        note: input.meeting,
        property: MEETING_PEOPLE_KEY,
        ...withIdentity(input),
      },
    },
  };
}

function ambiguousProposals(
  input: MeetingLinkInput,
  { attendee, candidates, differentAddress }: AmbiguousAttendee,
): NewProposal[] {
  const names = candidates.map(({ path }) => linkTo(input, path)).join(' or ');
  const why =
    differentAddress === true
      ? `“${attendee.name}” in the attendees has the name of ${names}, with a different address from the one on file. Accept if it was them.`
      : `“${attendee.name}” in the attendees could be ${names}. Accept the one it was, and reject the rest.`;
  return candidates.map((candidate) => ({
    kind: 'link',
    confidence: 'low',
    source: linkTo(input, input.meeting),
    madeBy: MEETING_LINKS_MAKER,
    id: proposalId(input, `ambiguous:${attendeeKey(attendee)}:${candidate.path}`),
    name: `${candidate.name} for ${attendee.name} — ${meetingTitle(input)}`,
    reason: why,
    payload: linkPayload(input, MEETING_PEOPLE_KEY, candidate.path),
  }));
}

/** A company only an attendee's domain names: proposed as a link, for a person to confirm. */
function companyProposal(
  input: MeetingLinkInput,
  { company, attendee }: GuessedCompany,
): NewProposal {
  return {
    kind: 'link',
    confidence: 'low',
    source: linkTo(input, input.meeting),
    madeBy: MEETING_LINKS_MAKER,
    id: proposalId(input, `company:${company.path}`),
    name: `${company.name} for ${meetingTitle(input)}`,
    reason: `${attendee.name}’s address is at ${emailDomainOf(attendee)}, which looks like ${linkTo(input, company.path)} — which declares no domain of its own, so it is not certain. Accept if it was involved.`,
    payload: linkPayload(input, MEETING_COMPANIES_KEY, company.path),
  };
}

function emailDomainOf({ email }: MeetingAttendee): string {
  return emailDomain(email) ?? 'a domain';
}

/** The likeliest open project, proposed once for a meeting that has none. */
function projectProposal(input: MeetingLinkInput): NewProposal | null {
  const [first, ...rest] = input.projects;
  const confidence = projectConfidence(input.projects);
  if (first === undefined || confidence === null) return null;
  if (linkedNotes(input.properties[MEETING_PROJECT_KEY]).length > 0) return null;
  const others = rest.slice(0, 3).map(({ project }) => linkTo(input, project));
  const tied =
    first.entities.length === 1
      ? 'one of its people or companies'
      : `${first.entities.length} of its people and companies`;
  return {
    kind: 'link',
    confidence,
    source: linkTo(input, input.meeting),
    madeBy: MEETING_LINKS_MAKER,
    id: proposalId(input, 'project'),
    name: `${first.title} for ${meetingTitle(input)}`,
    reason: [
      `${first.title} is open and tied to ${tied}.`,
      ...(others.length > 0 ? [`Also likely: ${others.join(', ')}.`] : []),
    ].join(' '),
    payload: linkPayload(input, MEETING_PROJECT_KEY, first.project),
  };
}

function linkPayload(input: MeetingLinkInput, property: string, path: VaultPath) {
  return {
    note: input.meeting,
    property,
    link: linkTo(input, path),
    digest: null,
    ...withIdentity(input),
  };
}

/** Which meeting this is by its provider and id, when its frontmatter says: how a proposal finds it once filed. */
function identityOf(input: MeetingLinkInput): MeetingIdentity | null {
  const text = (key: string) => {
    const value = input.properties[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const provider = text('provider');
  const externalId = text('external_id');
  return provider === '' || externalId === '' ? null : { provider, externalId };
}

function withIdentity(input: MeetingLinkInput): { meeting?: MeetingIdentity } {
  const meeting = identityOf(input);
  return meeting === null ? {} : { meeting };
}

/** A person is proposed once, whichever meeting they were at: known by their address alone. */
function personProposalId(attendee: MeetingAttendee): string {
  return `${MEETING_LINKS_MAKER}:person:${attendeeKey(attendee)}`;
}

/** The notes a relation of the meeting links now, resolved as the vault resolves links. */
function linkedPaths(input: MeetingLinkInput, key: string): Set<VaultPath> {
  const targets = linkedNotes(input.properties[key]).flatMap((item) => linkTargets(item));
  return new Set(targets.flatMap((target) => resolveWikiLinkTarget(target, input.notePaths) ?? []));
}

function newLinks(paths: readonly VaultPath[], present: ReadonlySet<VaultPath>): VaultPath[] {
  return [...new Set(paths)].filter((path) => !present.has(path));
}

function withLinks(input: MeetingLinkInput, key: string, paths: readonly VaultPath[]): string[] {
  return paths.reduce<string[]>(
    (value, path) => withLink({ value, link: linkTo(input, path), many: true }) as string[],
    linkedNotes(input.properties[key]),
  );
}

function linkTo(input: MeetingLinkInput, path: VaultPath): string {
  return `[[${wikiLinkTargetFor(path, input.notePaths)}]]`;
}

/** What a proposal about this meeting is for: by its identity, which filing does not change; by path when it has none. */
function proposalId(input: MeetingLinkInput, what: string): string {
  const meeting = identityOf(input);
  const of = meeting === null ? input.meeting : `${meeting.provider}/${meeting.externalId}`;
  return `${MEETING_LINKS_MAKER}:${of}:${what}`;
}

function meetingTitle(input: MeetingLinkInput): string {
  const title = input.properties['title'];
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : noteTitle(input.meeting);
}
