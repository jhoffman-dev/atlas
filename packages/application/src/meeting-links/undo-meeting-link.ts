import {
  isMeetingType,
  linksTakenBack,
  messageWithoutPaths,
  noteTitle,
  PROPOSAL_ID_KEY,
  readProposal,
  recordedLinks,
  splitFrontmatter,
  type MeetingLinkRecord,
  type PassedOver,
  type VaultPath,
} from '@atlas/domain';
import { setNoteProperties } from '../query/set-property.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { VaultAccessError } from '../vault/ports.ts';
import type { StampPorts } from '../meetings/meeting-stamp-writer.ts';

/** What undoing a meeting's linking did: how many links it took away, each proposal withdrawn, and what was left. */
export interface MeetingLinkUndone {
  /** The links taken out of the meeting's `people` and `companies`. */
  readonly removed: number;
  readonly withdrawn: readonly VaultPath[];
  /** Proposals it wrote that were not taken away, and why: answered since, or being typed in. */
  readonly left: readonly PassedOver[];
}

/** What undoing a meeting's links reaches: the note, the YAML writer, and the panes that may hold it. */
export type LinkUndoPorts = StampPorts;

/** A meeting's links not undone, for a reason the person is told in these words. */
export class LinkUndoRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'LinkUndoRefusedError';
  }
}

const ANSWERED = 'It was answered since, so it was left as it is.';

/**
 * Undoes linking a meeting (P29-04, P29-06), from the record linking left on
 * the meeting itself: each link it added that still stands as it wrote it is
 * taken out of `people` and `companies` — a link the person added, changed or
 * got by accepting a proposal is theirs, and stays — and each proposal it
 * wrote that is still open goes to the Trash. The meeting is marked
 * `atlas_links: undone`, so nothing links it again by itself.
 *
 * Refused, with nothing written: a note that is no meeting, one with nothing
 * recorded to undo, and one open with unsaved typing. The proposals are
 * withdrawn only after the meeting is written, so a refusal leaves both as
 * they were.
 */
export async function undoMeetingLinks({
  ports,
  path,
  today,
}: {
  ports: LinkUndoPorts;
  path: VaultPath;
  /** `YYYY-MM-DD`: the day of the write, as every property write is dated. */
  today: string;
}): Promise<MeetingLinkUndone> {
  const record = await recordAt(ports, path);
  if (ports.editors.state(path) === 'dirty') throw new UnsavedTypingError(path);
  let removed = 0;
  await setNoteProperties({
    fs: ports.fs,
    markdown: ports.markdown,
    path,
    today,
    // Worked out against the frontmatter as it is written: a link taken out by hand since is not counted.
    values: (properties) => {
      const taken = linksTakenBack({ properties, record: recordedLinks(properties) ?? record });
      removed = taken.removed;
      return taken.values;
    },
  });
  if (ports.editors.state(path) === 'clean') ports.editors.reload(path);
  const withdrawn: VaultPath[] = [];
  const left: PassedOver[] = [];
  for (const proposal of record.proposals) {
    const problem = await withdraw(ports, proposal);
    if (problem === null) withdrawn.push(proposal);
    else if (problem !== GONE) left.push({ path: proposal, reason: problem });
  }
  return { removed, withdrawn, left };
}

/** What linking recorded on the meeting at `path`, or the refusal when there is nothing to undo. */
async function recordAt(ports: LinkUndoPorts, path: VaultPath): Promise<MeetingLinkRecord> {
  const read = await ports.fs.readTextFile(path).catch((error: unknown) => {
    if (error instanceof VaultAccessError) {
      throw new LinkUndoRefusedError(`There is no meeting at ${path}.`);
    }
    throw error;
  });
  const properties = ports.markdown.frontmatterProperties(splitFrontmatter(read.text).frontmatter);
  if (!isMeetingType(properties['type'])) {
    throw new LinkUndoRefusedError(`${noteTitle(path)} is not a meeting, so nothing was undone.`);
  }
  const record = recordedLinks(properties);
  if (record === null) throw new LinkUndoRefusedError('This meeting has no links to undo.');
  return record;
}

/** What {@link withdraw} answers for a proposal that is not there: nothing to take away, and nothing to say. */
const GONE = 'gone';

/** Takes an open proposal away, or says why it was left. */
async function withdraw(ports: LinkUndoPorts, path: VaultPath): Promise<string | null> {
  if (ports.editors.state(path) === 'dirty')
    return 'It has unsaved typing, so it was left as it is.';
  let text: string;
  try {
    ({ text } = await ports.fs.readTextFile(path));
  } catch (cause) {
    // Not there — answered and archived, deleted by hand, or never written: there is nothing to take away.
    if (cause instanceof VaultAccessError) return GONE;
    return messageWithoutPaths(cause);
  }
  const properties = ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  const reading = readProposal({ path, properties });
  if (!reading.ok || reading.proposal.state !== 'open' || properties[PROPOSAL_ID_KEY] === undefined) {
    return ANSWERED;
  }
  try {
    await ports.fs.trashEntry({ path });
    return null;
  } catch (cause) {
    return messageWithoutPaths(cause);
  }
}
