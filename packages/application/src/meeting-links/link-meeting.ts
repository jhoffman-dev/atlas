import {
  attendeesOf,
  linkedEntities,
  matchAttendees,
  matchSpeakers,
  MEETING_TYPE,
  namedSpeakers,
  planMeetingLinks,
  rankProjects,
  splitFrontmatter,
  type DirectoryPerson,
  type DoneAction,
  type MeetingLinkPlan,
  type PassedOver,
  type PassedOverAttendee,
  type PriorValue,
  type VaultPath,
} from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { changeProperties, type PropertyChange } from '../automations/apply-changes.ts';
import { validateMeetingFile } from '../meetings/meeting-reading.ts';
import { writeProposals } from '../proposals/write-proposals.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { loadLinkDirectory, loadProjectTies } from './link-directory.ts';

/** What linking a meeting reaches: the vault, its index, the markdown port and the panes. */
export type MeetingLinkPorts = Pick<ArchivePorts, 'fs' | 'index' | 'markdown' | 'editors'>;

/** What linking one meeting did — kept so it can be undone, as an automation's run is. */
export interface MeetingLinkRun {
  readonly meeting: VaultPath;
  /** The people and companies it linked. */
  readonly linked: readonly VaultPath[];
  /** Each relation it set, with what it held before and after: what an undo puts back. */
  readonly done: readonly DoneAction[];
  /** Each proposal it wrote into the Inbox. */
  readonly proposed: readonly VaultPath[];
  /** What it could not write, and why: the meeting (unsaved typing, a change since), or a proposal. */
  readonly left: readonly PassedOver[];
  /** Unknown attendees it could not propose, and why. */
  readonly passedOver: readonly PassedOverAttendee[];
}

/** A meeting that cannot be linked, for a reason said in these words. */
export class MeetingLinkRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MeetingLinkRefusedError';
  }
}

/**
 * Links the meeting at `path` to its people, companies and likely project
 * (P29-04): a deterministic step, which the "after a meeting" pipeline runs
 * and which runs on its own as each meeting is imported until then.
 *
 * Its attendees are matched against the vault's people and companies, and
 * its transcript's named speakers against its people (`planMeetingLinks`
 * says how). What is sure is added to the meeting's `people` and `companies`
 * — the only keys it writes — recording what each held before, so
 * {@link undoMeetingLink} can put it back. A meeting with unsaved typing, or
 * changed since it was read, is left as it is, and said. What is unsure is
 * written as proposals in the Inbox, each once, however often this runs.
 */
export async function linkMeeting({
  ports,
  path,
  today,
  selfName = null,
}: {
  ports: MeetingLinkPorts;
  path: VaultPath;
  /** `YYYY-MM-DD`: the day of the write, as every write that may touch a task is dated. */
  today: string;
  /** The vault owner's name from their profile: an attendee of that name is never proposed. */
  selfName?: string | null;
}): Promise<MeetingLinkRun> {
  const plan = await planFor({ ports, path, selfName });
  const linked = await changeProperties({
    ports,
    changes: relationChanges(path, plan.properties, plan.changes),
    kind: 'set',
    today,
  });
  const proposals = await writeProposals({ ...ports, proposals: plan.proposals });
  const set = new Set(linked.done.map((line) => ('key' in line ? line.key : null)));
  const unreadable = plan.unreadable.map(({ reason }) => ({ path, reason }));
  return {
    meeting: path,
    linked: Object.entries(plan.added).flatMap(([key, paths]) => (set.has(key) ? paths : [])),
    done: linked.done,
    proposed: proposals.written,
    left: [...unreadable, ...linked.left, ...proposals.left],
    passedOver: plan.passedOver,
  };
}

/** What linking the meeting would do, worked out from the meeting, the index and the vault's notes. */
async function planFor({
  ports,
  path,
  selfName,
}: {
  ports: MeetingLinkPorts;
  path: VaultPath;
  selfName: string | null;
}): Promise<MeetingLinkPlan & { readonly properties: Readonly<Record<string, unknown>> }> {
  const read = await readMeeting(ports, path);
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const { people, companies } = await loadLinkDirectory({ index: ports.index });
  const matching = matchAttendees(attendeesOf(read.properties), people, companies);
  const speakers = speakersOf(ports, read.text, people);
  const entities = linkedEntities(matching, speakers);
  const ties = await loadProjectTies({ index: ports.index, meeting: path, entities });
  const projects = rankProjects(ties);
  const { properties } = read;
  const input = { meeting: path, properties, notePaths, matching, speakers, projects, selfName };
  return { ...planMeetingLinks(input), properties };
}

interface MeetingRead {
  readonly text: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

async function readMeeting(ports: MeetingLinkPorts, path: VaultPath): Promise<MeetingRead> {
  const read = await ports.fs.readTextFile(path).catch((error: unknown) => {
    if (error instanceof VaultAccessError)
      throw new MeetingLinkRefusedError(`There is no meeting at ${path}.`);
    throw error;
  });
  const properties = ports.markdown.frontmatterProperties(splitFrontmatter(read.text).frontmatter);
  if (!isMeeting(properties['type']))
    throw new MeetingLinkRefusedError(`${path} is not a meeting.`);
  return { text: read.text, properties };
}

/** A note is a meeting when any item of its `type` is, as the index counts it. */
function isMeeting(type: unknown): boolean {
  const items = Array.isArray(type) ? type : [type];
  return items.some(
    (item) => typeof item === 'string' && item.trim().toLowerCase() === MEETING_TYPE,
  );
}

/**
 * The people the transcript's named speakers surely are. Only a meeting that
 * follows the import contract has turns to read; one edited out of it is
 * linked by its attendees alone.
 */
function speakersOf(
  ports: MeetingLinkPorts,
  text: string,
  people: readonly DirectoryPerson[],
): DirectoryPerson[] {
  const reading = validateMeetingFile(ports.markdown, text);
  return reading.ok ? matchSpeakers(namedSpeakers(reading.meeting.transcript), people) : [];
}

/** Each relation to set, only while it still holds what was read. */
function relationChanges(
  path: VaultPath,
  properties: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, readonly string[]>>,
): PropertyChange[] {
  return Object.entries(changes).map(([key, value]) => ({
    path,
    key,
    expect: priorOf(properties, key),
    to: { value: [...value] },
  }));
}

function priorOf(properties: Readonly<Record<string, unknown>>, key: string): PriorValue {
  return Object.hasOwn(properties, key) ? { value: properties[key] } : { absent: true };
}
