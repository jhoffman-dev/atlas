import { isArchivedPath } from '../archive/archive.ts';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { ProposalConfidence } from '../proposals/proposal.ts';
import { paraOf } from '../types/para-value.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import type { DirectoryPerson } from './attendee-matching.ts';
import { isOwnerAttendee, isOwnerNote, ownerAddressesInUse } from './vault-owner.ts';

/** A project's statuses that say it is over: nothing is filed under it any more. */
export const CLOSED_PROJECT_STATUSES = ['done', 'cancelled', 'dropped'] as const;

/** The open project or area a meeting is filed under. */
export interface FiledProject {
  readonly path: VaultPath;
  readonly title: string;
}

/** A meeting as the series rule reads it (#227). */
export interface SeriesMeeting {
  readonly path: VaultPath;
  readonly title: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:MM`, local; null when its note does not say. */
  readonly start: string | null;
  readonly provider: string;
  /** Who was there besides the vault's owner ({@link meetingParticipants}). */
  readonly participants: readonly string[];
  /** The open project or area it is filed under; null when none, or one that is closed. */
  readonly project: FiledProject | null;
}

/** What a meeting is likely filed under, how sure that is, and why. */
export interface ProjectSuggestion {
  readonly project: VaultPath;
  readonly title: string;
  readonly confidence: ProposalConfidence;
  /** Whence: the same meeting's copy from another provider, or earlier meetings of its series. */
  readonly via: 'twin' | 'series';
  /** In a sentence: "Same series as 2026-10-07 Larkspur Standup: …". */
  readonly reason: string;
}

/** Two copies of one meeting start at most this far apart: the notetakers start recording at different moments. */
export const TWIN_START_MINUTES = 15;

/** How many of a series' latest days the majority is taken over: the recent past, not its whole history. */
export const SERIES_WINDOW = 6;

/**
 * Whether a note can have meetings filed under it: a project or an area by
 * its PARA — never a resource or an archived one (#213) — outside the
 * Archive, and not done, cancelled or dropped.
 */
export function isOpenFiling({
  path,
  type,
  para,
  status,
}: {
  path: string;
  type: unknown;
  para: unknown;
  status: unknown;
}): boolean {
  if (isArchivedPath(path)) return false;
  const value = paraOf({ type, para });
  if (value !== 'project' && value !== 'area') return false;
  const state = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return !(CLOSED_PROJECT_STATUSES as readonly string[]).includes(state);
}

/**
 * A meeting's title as a series shares it: letters and digits only, case
 * folded and accents dropped, so "Ledger v2 Sync" is "Ledger V2 Sync"
 * and "1:1" is "1-1".
 */
export function seriesTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The vault's owner, as a meeting's participants leave them out. */
export interface ParticipantOwner {
  readonly selfName: string | null;
  readonly selfEmails: readonly string[];
  /** The owner's own Person notes. */
  readonly notes: readonly VaultPath[];
}

/**
 * The vault's owner as participants leave them out: their name, the
 * addresses that are theirs ({@link ownerAddressesInUse}), and the Person
 * notes of that name or at one of those addresses.
 */
export function participantOwnerOf({
  people,
  selfName,
  selfEmails,
}: {
  people: readonly DirectoryPerson[];
  selfName: string | null;
  selfEmails: readonly string[];
}): ParticipantOwner {
  const emails = ownerAddressesInUse({ selfEmails, people, selfName });
  const mine = new Set(emails.map(folded));
  const notes = people
    .filter(
      (person) => isOwnerNote(person, selfName) || person.emails.some((e) => mine.has(folded(e))),
    )
    .map((person) => person.path);
  return { selfName, selfEmails: emails, notes };
}

const folded = (email: string) => email.trim().toLowerCase();

/**
 * Who was at a meeting besides the vault's owner, as keys two meetings can
 * share: each attendee's address (their name when they have none) and each
 * Person note it links. The owner is at every meeting, so sharing them
 * says nothing about which series a meeting is.
 */
export function meetingParticipants({
  attendees,
  people,
  owner,
}: {
  attendees: readonly MeetingAttendee[];
  people: readonly VaultPath[];
  owner: ParticipantOwner;
}): string[] {
  const ownNotes = new Set(owner.notes.map((path) => path.toLowerCase()));
  const listed = attendees
    .filter((attendee) => !isOwnerAttendee({ attendee, ...owner }))
    .map(({ name, email }) =>
      email === null ? `name:${seriesTitle(name)}` : `email:${folded(email)}`,
    );
  const linked = people
    .map((path) => path.toLowerCase())
    .filter((path) => !ownNotes.has(path))
    .map((path) => `note:${path}`);
  return [...new Set([...listed, ...linked])];
}

/**
 * Where `meeting` is likely filed, from the meetings around it (#227), or
 * null when nothing says: its twin — the same meeting recorded by another
 * notetaker — when that is filed; else the majority of its series' latest
 * meetings ({@link seriesSuggestion}). Never an AI's guess, and never a
 * closed project: `others` carry only open ones.
 */
export function suggestMeetingProject({
  meeting,
  others,
}: {
  meeting: SeriesMeeting;
  others: readonly SeriesMeeting[];
}): ProjectSuggestion | null {
  const elsewhere = others.filter((other) => other.path !== meeting.path);
  return twinSuggestion(meeting, elsewhere) ?? seriesSuggestion(meeting, elsewhere);
}

/** The filed copy of this meeting from another provider: same day, started close by, the same people or title. */
function twinSuggestion(
  meeting: SeriesMeeting,
  others: readonly SeriesMeeting[],
): ProjectSuggestion | null {
  const twins = others
    .filter((other) => other.project !== null && isTwin(meeting, other))
    .sort((left, right) => startGap(meeting, left) - startGap(meeting, right));
  const twin = twins[0];
  const project = twin?.project ?? null;
  if (twin === undefined || project === null) return null;
  return {
    project: project.path,
    title: project.title,
    confidence: 'high',
    via: 'twin',
    reason: `The same meeting as ${twin.provider}’s copy, ${described(twin)}, which is filed under ${project.title}.`,
  };
}

function isTwin(meeting: SeriesMeeting, other: SeriesMeeting): boolean {
  if (other.date !== meeting.date || other.provider === meeting.provider) return false;
  if (startGap(meeting, other) > TWIN_START_MINUTES) return false;
  return sharesParticipant(meeting, other) || sameSeriesTitle(meeting, other);
}

/** Minutes between two meetings' starts; past any twin when either does not say. */
function startGap(left: SeriesMeeting, right: SeriesMeeting): number {
  const [from, to] = [minutesOf(left.start), minutesOf(right.start)];
  return from === null || to === null ? Number.POSITIVE_INFINITY : Math.abs(from - to);
}

function minutesOf(start: string | null): number | null {
  const match = start === null ? null : /^(\d{1,2}):(\d{2})/.exec(start.trim());
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** The filed meetings of `meeting`'s series, and whether only their titles tie them to it. */
function seriesOf(meeting: SeriesMeeting, others: readonly SeriesMeeting[]) {
  const titled = others.filter(
    (other) => other.project !== null && sameSeriesTitle(meeting, other),
  );
  const sharing = titled.filter((other) => sharesParticipant(meeting, other));
  if (sharing.length > 0) return { members: sharing, titleOnly: false };
  // Neither side lists anyone to compare: the title is all there is to go on.
  const unlisted = titled.filter(
    (other) => meeting.participants.length === 0 || other.participants.length === 0,
  );
  return { members: unlisted, titleOnly: true };
}

function sameSeriesTitle(left: SeriesMeeting, right: SeriesMeeting): boolean {
  const title = seriesTitle(left.title);
  return title !== '' && title === seriesTitle(right.title);
}

function sharesParticipant(left: SeriesMeeting, right: SeriesMeeting): boolean {
  const theirs = new Set(right.participants);
  return left.participants.some((participant) => theirs.has(participant));
}

/** One day of a series, and the projects its meetings that day are filed under. */
interface SeriesDay {
  readonly date: string;
  readonly meetings: readonly SeriesMeeting[];
}

/**
 * The project most of the series' latest days are filed under (#227): the
 * {@link SERIES_WINDOW} days nearest the meeting, each day one vote per
 * project — two notetakers' copies of one meeting are one meeting. A tie
 * goes to the nearest day.
 *
 * High when two or more days agree, two thirds of them, the nearest among
 * them, and the series shares people with the meeting; medium on a plain
 * majority, or a series of one; low when the nearest day had to break a tie
 * or no project holds a majority. A series tied by title alone, with nobody
 * listed to compare, is medium at most.
 */
function seriesSuggestion(
  meeting: SeriesMeeting,
  others: readonly SeriesMeeting[],
): ProjectSuggestion | null {
  const { members, titleOnly } = seriesOf(meeting, others);
  const days = nearestDays(meeting, members).slice(0, SERIES_WINDOW);
  const tally = tallied(days);
  const [winner, runnerUp] = tally;
  if (winner === undefined) return null;
  const tied = runnerUp !== undefined && runnerUp.votes === winner.votes;
  const nearestAgrees = filedUnder(days[0], winner.project.path);
  const share = winner.votes / days.length;
  const confidence = seriesConfidence({ votes: winner.votes, share, tied, nearestAgrees, days });
  const latest = days.find((day) => filedUnder(day, winner.project.path))!;
  return {
    project: winner.project.path,
    title: winner.project.title,
    confidence: titleOnly && confidence === 'high' ? 'medium' : confidence,
    via: 'series',
    reason: seriesReason({ latest, winner, days: days.length, titleOnly }),
  };
}

function seriesConfidence({
  votes,
  share,
  tied,
  nearestAgrees,
  days,
}: {
  votes: number;
  share: number;
  tied: boolean;
  nearestAgrees: boolean;
  days: readonly SeriesDay[];
}): ProposalConfidence {
  if (tied) return 'low';
  if (votes >= 2 && share >= 2 / 3 && nearestAgrees) return 'high';
  if (share > 1 / 2 || days.length === 1) return 'medium';
  return 'low';
}

/** The series' days, nearest the meeting first; of two as near, the later. */
function nearestDays(meeting: SeriesMeeting, members: readonly SeriesMeeting[]): SeriesDay[] {
  const byDate = new Map<string, SeriesMeeting[]>();
  for (const member of members)
    byDate.set(member.date, [...(byDate.get(member.date) ?? []), member]);
  const held = dayNumber(meeting.date);
  return [...byDate]
    .map(([date, meetings]) => ({ date, meetings, distance: Math.abs(dayNumber(date) - held) }))
    .sort((left, right) => left.distance - right.distance || compareText(right.date, left.date))
    .map(({ date, meetings }) => ({ date, meetings }));
}

/** Days since the epoch of a `YYYY-MM-DD`; a date that is none counts as far off. */
function dayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return Number.MAX_SAFE_INTEGER / 2;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

interface Tally {
  readonly project: FiledProject;
  readonly votes: number;
  /** The index of the nearest day filed under it: what breaks a tie. */
  readonly nearest: number;
}

/** Each project's votes, one per day, most first; a tie, the nearer first, then by title and path. */
function tallied(days: readonly SeriesDay[]): Tally[] {
  const tally = new Map<VaultPath, Tally>();
  days.forEach((day, at) => {
    for (const project of projectsOf(day)) {
      const counted = tally.get(project.path);
      tally.set(project.path, {
        project,
        votes: (counted?.votes ?? 0) + 1,
        nearest: counted?.nearest ?? at,
      });
    }
  });
  return [...tally.values()].sort(
    (left, right) =>
      right.votes - left.votes ||
      left.nearest - right.nearest ||
      compareText(left.project.title.toLowerCase(), right.project.title.toLowerCase()) ||
      compareText(left.project.path, right.project.path),
  );
}

function projectsOf(day: SeriesDay): FiledProject[] {
  const projects = new Map<VaultPath, FiledProject>();
  for (const { project } of day.meetings) if (project !== null) projects.set(project.path, project);
  return [...projects.values()];
}

function filedUnder(day: SeriesDay | undefined, project: VaultPath): boolean {
  return day?.meetings.some((meeting) => meeting.project?.path === project) === true;
}

function seriesReason({
  latest,
  winner,
  days,
  titleOnly,
}: {
  latest: SeriesDay;
  winner: Tally;
  days: number;
  titleOnly: boolean;
}): string {
  const meeting = latest.meetings.find((each) => each.project?.path === winner.project.path)!;
  const share =
    days === 1
      ? `, which is filed under ${winner.project.title}`
      : `: ${winner.votes} of its last ${days} were filed under ${winner.project.title}`;
  const basis = titleOnly ? ' Matched by title alone: neither lists anyone to compare.' : '';
  return `Same series as ${described(meeting)}${share}.${basis}`;
}

/** "2026-10-07 Larkspur Standup". */
function described(meeting: SeriesMeeting): string {
  return `${meeting.date} ${meeting.title}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
