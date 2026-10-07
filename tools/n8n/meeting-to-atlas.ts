import { readAttendees, type Attendee } from './meeting-attendees.ts';
import { meetingPaths } from './meeting-file-name.ts';
import { MeetingMappingError, oneLine } from './meeting-mapping-error.ts';
import { nextStepsText, sectionText } from './meeting-text.ts';
import {
  firstSpoken,
  readTranscript,
  transcriptText,
  type Transcript,
} from './meeting-transcript.ts';
import { readStated } from './meeting-stated.ts';
import { meetingWhen, type MeetingWhen } from './meeting-when.ts';

/**
 * What James's n8n parse step hands over, by the mapper's names (the
 * "Meeting fields for Atlas" node renames his fields to these). Untyped: it
 * comes from n8n as JSON.
 */
export interface MeetingFields {
  readonly title?: unknown;
  readonly date?: unknown;
  readonly start?: unknown;
  readonly end?: unknown;
  /** The provider's email subject (or doc title) stating the meeting's day, and time if given. */
  readonly stated?: unknown;
  /** When the notes email arrived: the fallback for a start, less the transcript's length. */
  readonly arrived?: unknown;
  readonly attendees?: unknown;
  readonly summary?: unknown;
  readonly decisions?: unknown;
  readonly nextSteps?: unknown;
  readonly details?: unknown;
  readonly transcript?: unknown;
  readonly category?: unknown;
  readonly source?: unknown;
  readonly sourceId?: unknown;
}

export interface MappingOptions {
  /**
   * An IANA zone (`America/Los_Angeles`) to read instants (`...Z`, `-07:00`)
   * in. Null (the default) refuses an instant, having no zone to read it in;
   * a date or a time without an offset is taken as written either way.
   */
  readonly timeZone?: string | null;
  /** Addresses to treat as groups that the address rule misses. */
  readonly groupAddresses?: readonly string[];
}

/** One contract file, and what n8n needs to commit it. */
export interface MeetingFile {
  readonly path: string;
  readonly collisionPath: string;
  readonly content: string;
  readonly title: string;
  readonly provider: string;
  readonly externalId: string;
  readonly commitMessage: string;
}

const PROVIDER = /^[a-z][a-z0-9-]*$/;

function required(value: unknown, field: string): string {
  const text = oneLine(value);
  if (text === '') throw new MeetingMappingError(`${field}: missing`);
  return text;
}

function providerOf(source: unknown): string {
  const provider = required(source, 'source').toLowerCase();
  if (!PROVIDER.test(provider)) {
    throw new MeetingMappingError(`source: "${provider}" is not a provider name like gemini`);
  }
  return provider;
}

/** A YAML scalar that every reader takes as text: single-quoted, `'` doubled. */
const quoted = (text: string) => `'${text.replace(/'/g, "''")}'`;

function attendeeYaml({ name, email, group }: Attendee): string[] {
  return [
    `  - name: ${quoted(name)}`,
    ...(email === undefined ? [] : [`    email: ${quoted(email)}`]),
    ...(group ? ['    group: true'] : []),
  ];
}

interface Header {
  readonly title: string;
  readonly when: MeetingWhen;
  readonly kind: string;
  readonly provider: string;
  readonly externalId: string;
  readonly clock: Transcript['clock'] | null;
  readonly attendees: readonly Attendee[];
}

function frontmatter(header: Header): string {
  const { title, when, kind, provider, externalId, clock, attendees } = header;
  const lines = [
    '---',
    'type: meeting',
    'atlas_import: meeting/v1',
    `title: ${quoted(title)}`,
    `date: ${quoted(when.date)}`,
    `start: ${quoted(when.start)}`,
    ...(when.startApproximate ? ['start_approximate: true'] : []),
    ...(when.end === null ? [] : [`end: ${quoted(when.end)}`]),
    ...(kind === '' ? [] : [`kind: ${quoted(kind)}`]),
    `provider: ${quoted(provider)}`,
    `external_id: ${quoted(externalId)}`,
    ...(clock === null ? [] : [`transcript_clock: ${clock}`]),
    ...(attendees.length === 0 ? [] : ['attendees:', ...attendees.flatMap(attendeeYaml)]),
    '---',
  ];
  return lines.join('\n');
}

/**
 * Gemini's Details become Notes. Its Decisions (which the contract has no
 * section for) go under them as `### Decisions`, so they are kept, not lost.
 */
function notesText(fields: MeetingFields): string {
  const details = sectionText(fields.details, 'details');
  const decisions = sectionText(fields.decisions, 'decisions');
  if (decisions === '') return details;
  return [details, `### Decisions\n\n${decisions}`].filter(Boolean).join('\n\n');
}

function body(fields: MeetingFields, transcript: Transcript): string {
  const sections: [string, string][] = [
    ['Summary', sectionText(fields.summary, 'summary')],
    ['Notes', notesText(fields)],
    ['Provider next steps', nextStepsText(fields.nextSteps)],
    ['Transcript', transcriptText(transcript.turns)],
  ];
  return sections
    .filter(([, text]) => text !== '')
    .map(([heading, text]) => `## ${heading}\n\n${text}`)
    .join('\n\n');
}

/**
 * One meeting as a meeting/v1 contract file (vault/docs/contracts/meeting-import-v1.md),
 * with the path it goes to and the commit message. Throws a
 * {@link MeetingMappingError} when a required field is missing, rather than
 * writing a file Atlas would refuse.
 */
export function mapMeeting(fields: MeetingFields, options: MappingOptions = {}): MeetingFile {
  const title = required(fields.title, 'title');
  const provider = providerOf(fields.source);
  const externalId = required(fields.sourceId, 'sourceId');
  const attendees = readAttendees(fields.attendees, options.groupAddresses ?? []);
  const transcript = readTranscript(
    fields.transcript,
    attendees.map((each) => each.name),
  );
  const when = meetingWhen({
    date: fields.date,
    start: fields.start,
    end: fields.end,
    stated: readStated(fields.stated),
    arrived: fields.arrived,
    transcriptLength: transcript.length,
    firstSpoken: firstSpoken(transcript),
    timeZone: options.timeZone ?? null,
  });
  const header: Header = {
    title,
    when,
    kind: oneLine(fields.category),
    provider,
    externalId,
    clock: transcript.turns.length === 0 ? null : transcript.clock,
    attendees,
  };
  const text = body(fields, transcript);
  return {
    ...meetingPaths({ date: when.date, title, provider, externalId }),
    content: `${frontmatter(header)}\n${text === '' ? '' : `\n${text}\n`}`,
    title,
    provider,
    externalId,
    commitMessage: `Meeting: ${title} (${provider})`,
  };
}

/** A frontmatter value as text, its YAML quotes taken off. */
function frontmatterValue(frontmatterText: string, key: string): string | null {
  const line = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(frontmatterText);
  const value = line?.[1];
  if (value === undefined) return null;
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(value)) return value.slice(1, -1).replace(/\\"/g, '"');
  return value;
}

/**
 * Whether a file already in the repository is this meeting: the same
 * `provider` and `external_id` (ADR-0027's duplicate rule). Read line by line
 * so it needs no YAML library inside n8n.
 */
export function sameMeeting(
  existing: string,
  meeting: { readonly provider: string; readonly externalId: string },
): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(existing);
  if (match === null) return false;
  const header = match[1] ?? '';
  return (
    frontmatterValue(header, 'provider') === meeting.provider &&
    frontmatterValue(header, 'external_id') === meeting.externalId
  );
}

/**
 * The text of a file the GitHub API returned, which comes base64-encoded with
 * line breaks. Buffer first: n8n documents it in the Code node; atob and
 * TextDecoder are the fallback where it is missing.
 */
export function decodeBase64(encoded: string): string {
  const compact = encoded.replace(/\s/g, '');
  if (typeof Buffer === 'function') return Buffer.from(compact, 'base64').toString('utf8');
  const binary = atob(compact);
  return new TextDecoder().decode(Uint8Array.from(binary, (each) => each.charCodeAt(0)));
}

/** A file as n8n's GitHub node returns it from File → Get. */
export interface GitHubFile {
  readonly content?: unknown;
  /** `base64`, or `none` when GitHub sent no content. */
  readonly encoding?: unknown;
  readonly size?: unknown;
}

/**
 * The text of the file at a meeting's path. GitHub sends no content for a
 * file over 1 MB; such a file may be this meeting or not, so it is refused
 * rather than guessed at — a guess of "another meeting" would write a
 * duplicate at the collision path.
 */
export function existingFileText(file: GitHubFile): string {
  const { content, size } = file;
  if (typeof content === 'string' && (content !== '' || size === 0)) return decodeBase64(content);
  throw new MeetingMappingError(
    `cannot read the file already at this path (GitHub sends no content for a file over 1 MB, size ${String(size)}); not writing, so as not to write the meeting twice`,
  );
}

/**
 * True when the file at the collision path is this meeting (the workflow then
 * skips). Throws when it is another meeting: both of this meeting's paths are
 * taken, and writing anywhere else would break the path rule.
 */
export function sameMeetingAtOtherPath(
  file: GitHubFile,
  meeting: { readonly provider: string; readonly externalId: string },
): true {
  if (sameMeeting(existingFileText(file), meeting)) return true;
  throw new MeetingMappingError(
    `another meeting holds both paths of ${meeting.provider} ${meeting.externalId}; not writing it`,
  );
}
