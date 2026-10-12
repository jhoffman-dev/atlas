import {
  addedLinks,
  attendeesOf,
  isMeetingType,
  linkedEntities,
  linkRecordProperties,
  linksUndone,
  matchAttendees,
  matchSpeakers,
  messageWithoutPaths,
  namedSpeakers,
  ownerAddresses,
  planMeetingLinks,
  rankProjects,
  splitFrontmatter,
  stillAsLeft,
  wasLinked,
  type AddedLinks,
  type DirectoryPerson,
  type DoneAction,
  type MeetingLinkPlan,
  type PassedOver,
  type PassedOverAttendee,
  type PriorValue,
  type TranscriptTurn,
  type VaultPath,
  type Vocabulary,
} from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { UNSAVED_TYPING } from '../automations/apply-changes.ts';
import { VaultChangedError } from '../automations/vault-guard.ts';
import { meetingTextAsCorrected } from '../meetings/meeting-corrections.ts';
import { validateMeetingFile } from '../meetings/meeting-reading.ts';
import {
  planProposals,
  writePlannedProposals,
  type ProposalsPlanned,
} from '../proposals/write-proposals.ts';
import { setNoteProperties } from '../query/set-property.ts';
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
  /** Why none of its proposals were written, when the Inbox could not be read or written; null otherwise. */
  readonly unproposed: string | null;
  /**
   * Whether the record of this linking is on the meeting now. False when the
   * meeting could not be written — unsaved typing, a change since — so it
   * holds no record and is linked again the next time this runs.
   */
  readonly recorded: boolean;
  /**
   * The record of this linking, for the caller to write, when it asked to
   * write it itself (`recordInStamp`) and linking had nothing else to write
   * to the meeting. The import stamps it in the write that lets the meeting
   * in, so a meeting nobody was linked to costs no write of its own.
   */
  readonly stamp?: Readonly<Record<string, unknown>>;
  /**
   * Set when the meeting had been linked before — or its links undone — and
   * so was left as it is: nothing above was done by this call.
   */
  readonly already?: { readonly undone: boolean };
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
 * says how) — the speakers as the vocabulary corrects them (P28-06), whether
 * or not the meeting's words have been corrected yet, so the order of the two
 * steps does not change who is linked. What is sure is added to the meeting's `people` and `companies`
 * — the only keys it writes — recording what each held before, so
 * {@link undoMeetingLink} can put it back. A meeting with unsaved typing, or
 * changed since it was read, is left as it is, and said. What is unsure is
 * written as proposals in the Inbox, each once, however often this runs.
 *
 * The links are written first. If the proposals then cannot be — the Inbox
 * refuses to be listed or written — the run still says who it linked, with
 * what it set, and why nothing was proposed (`unproposed`): the links are in
 * the meeting, and saying it could not be linked would be untrue.
 *
 * What it added is recorded on the meeting in the same write (`atlas_links`,
 * P29-06), as its corrections are: so {@link undoMeetingLinks} can take the
 * links back long after this run is forgotten, and so the meeting is linked
 * once — a meeting that holds the record, in any form, is answered `already`
 * and nothing is read or written for it. One that never got the record — it
 * was being typed in, or linking failed — is linked the next time this runs.
 */
export async function linkMeeting({
  ports,
  path,
  today,
  selfName = null,
  vocabulary,
  recordInStamp = false,
}: {
  ports: MeetingLinkPorts;
  path: VaultPath;
  /** `YYYY-MM-DD`: the day of the write, as every write that may touch a task is dated. */
  today: string;
  /**
   * Whether the caller writes the record itself when linking adds no link:
   * the import, whose stamp write follows at once. The record then comes
   * back as `stamp`, and the meeting is not written here at all.
   */
  recordInStamp?: boolean;
  /** The vault owner's name from their profile: an attendee of that name is never proposed. */
  selfName?: string | null;
  /** The vocabulary the caller's run corrects by, so speakers are read by the same one; read from the index when not given. */
  vocabulary?: Vocabulary | undefined;
}): Promise<MeetingLinkRun> {
  const read = await readMeeting(ports, path);
  if (wasLinked(read.properties)) return alreadyLinked(path, read.properties);
  const plan = await planFor({ ports, path, selfName, vocabulary, read });
  const planned = await planProposals({ ...ports, proposals: plan.proposals }).then(
    (made) => ({ ...made, unproposed: null }),
    (cause: unknown) => ({ planned: [], left: [], unproposed: messageWithoutPaths(cause) }),
  );
  const deferred = recordInStamp && Object.keys(plan.changes).length === 0;
  const linked = deferred
    ? { done: [], left: [], recorded: false }
    : await writeLinks({ ports, path, plan, planned, today });
  const proposals = await writePlannedProposals(ports.fs, planned.planned);
  const stamp = linkRecordProperties({
    links: [],
    proposals: planned.planned.map((proposal) => proposal.path),
  });
  const set = new Set(linked.done.map((line) => ('key' in line ? line.key : null)));
  const unreadable = plan.unreadable.map(({ reason }) => ({ path, reason }));
  return {
    meeting: path,
    linked: Object.entries(plan.added).flatMap(([key, paths]) => (set.has(key) ? paths : [])),
    done: linked.done,
    proposed: proposals.written,
    left: [...unreadable, ...linked.left, ...planned.left, ...proposals.left],
    passedOver: plan.passedOver,
    unproposed: planned.unproposed,
    recorded: linked.recorded,
    ...(deferred && { stamp }),
  };
}

/** What linking answers for a meeting linked before: nothing done, and whether its links were undone. */
function alreadyLinked(
  path: VaultPath,
  properties: Readonly<Record<string, unknown>>,
): MeetingLinkRun {
  return {
    meeting: path,
    linked: [],
    done: [],
    proposed: [],
    left: [],
    passedOver: [],
    unproposed: null,
    recorded: true,
    already: { undone: linksUndone(properties) },
  };
}

/**
 * Adds the plan's links to the meeting and records them, in one write: each
 * relation only while it still holds what the plan read, and the record of
 * exactly the links that went in — with the proposals about to be written for
 * it. A meeting with unsaved typing is left, record and all, and said.
 */
async function writeLinks({
  ports,
  path,
  plan,
  planned,
  today,
}: {
  ports: MeetingLinkPorts;
  path: VaultPath;
  plan: MeetingLinkPlan & { readonly properties: Readonly<Record<string, unknown>> };
  planned: Pick<ProposalsPlanned, 'planned'>;
  today: string;
}): Promise<{ done: DoneAction[]; left: PassedOver[]; recorded: boolean }> {
  if (ports.editors.state(path) === 'dirty') {
    return { done: [], left: [{ path, reason: UNSAVED_TYPING }], recorded: false };
  }
  const done: DoneAction[] = [];
  const left: PassedOver[] = [];
  try {
    await setNoteProperties({
      fs: ports.fs,
      markdown: ports.markdown,
      path,
      today,
      values: (properties) => {
        const written: Record<string, unknown> = {};
        const links: AddedLinks[] = [];
        for (const [key, value] of Object.entries(plan.changes)) {
          const [before, read] = [priorOf(properties, key), priorOf(plan.properties, key)];
          if (!stillAsLeft(before, read)) {
            left.push({ path, reason: `Its ${key} has changed since, so it was left as it is.` });
            continue;
          }
          written[key] = [...value];
          links.push({ key, added: addedLinks(properties[key], value) });
          done.push({ kind: 'set', path, key, before, after: { value: [...value] } });
        }
        const proposals = planned.planned.map((proposal) => proposal.path);
        return { ...written, ...linkRecordProperties({ links, proposals }) };
      },
    });
  } catch (cause) {
    // Another vault is open: the run this is part of must stop, not carry on to its proposals.
    if (cause instanceof VaultChangedError) throw cause;
    // The reason is kept in Activity and a rule's log, which any tool can read.
    return { done: [], left: [{ path, reason: messageWithoutPaths(cause) }], recorded: false };
  }
  if (ports.editors.state(path) === 'clean') ports.editors.reload(path);
  return { done, left, recorded: true };
}

/** What linking the meeting would do, worked out from the meeting, the index and the vault's notes. */
async function planFor({
  ports,
  path,
  selfName,
  vocabulary,
  read,
}: {
  ports: MeetingLinkPorts;
  path: VaultPath;
  selfName: string | null;
  vocabulary: Vocabulary | undefined;
  read: MeetingRead;
}): Promise<MeetingLinkPlan & { readonly properties: Readonly<Record<string, unknown>> }> {
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const { people, companies } = await loadLinkDirectory({ index: ports.index });
  const matching = matchAttendees(attendeesOf(read.properties), people, companies);
  // As corrected (P28-06): the import corrects in its stamp write, after this, so a misheard speaker is read as it will arrive.
  const corrected = await meetingTextAsCorrected({ ports, text: read.text, vocabulary });
  const speakers = speakersOf(ports, { heard: read.text, corrected }, people);
  const entities = linkedEntities(matching, speakers);
  const ties = await loadProjectTies({ index: ports.index, meeting: path, entities });
  const projects = rankProjects(ties);
  const { properties } = read;
  const selfEmails = ownerAddresses(people, selfName);
  const input = {
    meeting: path,
    properties,
    notePaths,
    matching,
    speakers,
    projects,
    selfName,
    selfEmails,
  };
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
  if (!isMeetingType(properties['type']))
    throw new MeetingLinkRefusedError(`${path} is not a meeting.`);
  return { text: read.text, properties };
}

/**
 * The people the transcript's named speakers surely are. Only a meeting that
 * follows the import contract has turns to read; one edited out of it is
 * linked by its attendees alone.
 *
 * A label is tried as it was heard first — a name or an alias someone goes
 * by — and only one that is nobody's is tried as the vocabulary corrects it:
 * an alias links (ADR-0027, "Aliases link, Terms correct"), so a term that
 * lists the same spelling as misheard does not take the person away.
 */
function speakersOf(
  ports: MeetingLinkPorts,
  { heard, corrected }: { heard: string; corrected: string },
  people: readonly DirectoryPerson[],
): DirectoryPerson[] {
  const asCorrected = turnsOf(ports, corrected);
  const tried = new Set<string>();
  const found = new Map<VaultPath, DirectoryPerson>();
  turnsOf(ports, heard).forEach((turn, at) => {
    const [name] = namedSpeakers([turn]);
    if (name === undefined || tried.has(name)) return;
    tried.add(name);
    const byHeard = matchSpeakers([name], people);
    // The correction changes spellings, never the turns: turn for turn, the same speaker.
    const corrects = asCorrected[at];
    const matched =
      byHeard.length > 0 || corrects === undefined
        ? byHeard
        : matchSpeakers(namedSpeakers([corrects]), people);
    for (const person of matched) found.set(person.path, person);
  });
  return [...found.values()];
}

/** A meeting's turns; none when it does not follow the contract, and so has none to read. */
function turnsOf(ports: MeetingLinkPorts, text: string): readonly TranscriptTurn[] {
  const reading = validateMeetingFile(ports.markdown, text);
  return reading.ok ? reading.meeting.transcript : [];
}

function priorOf(properties: Readonly<Record<string, unknown>>, key: string): PriorValue {
  return Object.hasOwn(properties, key) ? { value: properties[key] } : { absent: true };
}
