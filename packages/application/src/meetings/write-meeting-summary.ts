import {
  MEETING_TASKS_KEY,
  noteTitle,
  placeSummary,
  removeSummary,
  SUMMARY_DIGEST_KEY,
  SUMMARY_MODEL_KEY,
  SUMMARY_OF_KEY,
  tasksJoined,
  tasksParted,
  type SummaryRefusal,
  type VaultPath,
} from '@atlas/domain';
import { ProposalRefused } from '../chat/proposals.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { readLinkNote, type NoteWritePorts } from '../proposals/proposal-writes.ts';
import { writeStamp } from './meeting-stamp-writer.ts';

/** What the declared step writes to one meeting, last, in one write (ADR-0036). */
export interface MeetingSummaryWrite {
  readonly meeting: VaultPath;
  /** When the step read the meeting: the write is refused if it changed since. */
  readonly modified: number;
  /** The summary block to place, as `renderSummaryBlock` wrote it; null when there is none to write. */
  readonly block: string | null;
  /** The digest of the transcript the summary is of: `atlas_summary_of`. */
  readonly summaryOf: string | null;
  readonly model: string;
  /** The tasks to join into the meeting's `tasks`: made now, or made before and not yet listed. */
  readonly tasks: readonly VaultPath[];
  /** Every note in the vault, the tasks included: what a link to a task is spelt against. */
  readonly notePaths: readonly VaultPath[];
}

/** What the write did to the meeting. */
export interface MeetingSummaryWritten {
  /** The block's digest when it was written; null when none was. */
  readonly digest: string | null;
  /** Why the block was left as the person has it, when it was: a refusal of the grammar's. */
  readonly kept: { readonly refusal: SummaryRefusal; readonly reason: string } | null;
  /** The tasks it joined into the meeting's `tasks`. */
  readonly joined: readonly VaultPath[];
}

/**
 * The write was refused, with nothing written: the meeting has unsaved typing
 * in a pane, changed since the step read it, or is not there. The summary and
 * the `tasks` relation are written later, from the answer the step keeps.
 */
export class MeetingSummaryRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingSummaryRefused';
  }
}

/**
 * Writes a meeting's summary block, its keys and its `tasks` relation in one
 * write (#185, ADR-0036 "One meeting write, tasks first"), guarded by the
 * modified time the step read: the step makes the tasks first, so no summary
 * lists a task that does not exist.
 *
 * The block is placed by the domain's rule (`placeSummary`): replaced only
 * when it is the one recorded, so the person's edits are never written over.
 * A block the grammar refuses is left as it is (`kept`), and the tasks are
 * still joined. The keys go after the `atlas_import:` line; every byte
 * outside the block and the keys is kept.
 *
 * Rejects with {@link MeetingSummaryRefused}, writing nothing, when the
 * meeting has unsaved typing, changed since `modified`, or is gone.
 */
export async function writeMeetingSummary(
  ports: NoteWritePorts,
  write: MeetingSummaryWrite,
): Promise<MeetingSummaryWritten> {
  const link = await readMeeting(ports, write.meeting, WRITING);
  if (link.modified !== write.modified) throw WRITING.changed(noteTitle(write.meeting));
  const properties = ports.markdown.frontmatterProperties(link.document.frontmatter);
  const recorded = properties[SUMMARY_DIGEST_KEY];
  const placed =
    write.block === null
      ? null
      : placeSummary(link.document.body, write.block, {
          recorded: typeof recorded === 'string' ? recorded : null,
        });
  const tasks =
    link.target.relation === null
      ? null
      : tasksJoined({
          value: link.target.value,
          tasks: write.tasks,
          notePaths: write.notePaths,
          many: link.target.relation.many,
        });
  const summary =
    placed?.ok === true
      ? {
          [SUMMARY_DIGEST_KEY]: placed.digest,
          [SUMMARY_OF_KEY]: write.summaryOf,
          [SUMMARY_MODEL_KEY]: write.model,
        }
      : {};
  const values = { ...summary, ...(tasks !== null && { [MEETING_TASKS_KEY]: tasks }) };
  const written: MeetingSummaryWritten = {
    digest: placed?.ok === true ? placed.digest : null,
    kept: placed === null || placed.ok ? null : { refusal: placed.refusal, reason: placed.reason },
    joined: tasks === null ? [] : write.tasks,
  };
  if (Object.keys(values).length === 0) return written;
  await stamped(
    ports,
    {
      path: write.meeting,
      modified: link.modified,
      values,
      ...(placed?.ok === true && { body: placed.body }),
    },
    WRITING,
  );
  return written;
}

/**
 * Takes a run's summary back off a meeting (#185, Undo last run): the block
 * while it is still the one written (`digest`), its keys, and the links to the
 * tasks the undo trashed. A block edited since is left, and so is everything
 * else: the refusal says why.
 */
export async function undoMeetingSummary(
  ports: NoteWritePorts,
  {
    meeting,
    digest,
    trashed,
    notePaths,
  }: {
    meeting: VaultPath;
    digest: string;
    /** The tasks the undo trashed: their links leave the meeting's `tasks`. */
    trashed: readonly VaultPath[];
    /** Every note the links were spelt against, the trashed tasks included. */
    notePaths: readonly VaultPath[];
  },
): Promise<void> {
  const link = await readMeeting(ports, meeting, UNDOING);
  const removed = removeSummary(link.document.body, { recorded: digest });
  if (!removed.ok) throw new MeetingSummaryRefused(removed.reason);
  const tasks = tasksParted({ value: link.target.value, tasks: trashed, notePaths });
  await stamped(
    ports,
    {
      path: meeting,
      modified: link.modified,
      values: {
        [SUMMARY_DIGEST_KEY]: null,
        [SUMMARY_OF_KEY]: null,
        [SUMMARY_MODEL_KEY]: null,
        ...(tasks !== undefined && { [MEETING_TASKS_KEY]: tasks }),
      },
      body: removed.body,
    },
    UNDOING,
  );
}

/** What a refusal says, by what was being done. */
interface Refusals {
  readonly unsaved: (title: string) => MeetingSummaryRefused;
  readonly changed: (title: string) => MeetingSummaryRefused;
}

const WRITING: Refusals = {
  unsaved: (title) =>
    new MeetingSummaryRefused(
      `“${title}” has unsaved typing, so its summary was not written yet; it is written from the same answer once it is saved.`,
    ),
  changed: (title) =>
    new MeetingSummaryRefused(
      `“${title}” changed while Claude read it, so its summary was not written yet; it is written from the same answer on the next try.`,
    ),
};

const UNDOING: Refusals = {
  unsaved: (title) =>
    new MeetingSummaryRefused(`“${title}” has unsaved typing, so its summary was left as it is.`),
  changed: (title) =>
    new MeetingSummaryRefused(`“${title}” changed just now, so its summary was left as it is.`),
};

/** The meeting as it is now, with its `tasks` as its type reads it; refused when typed in or gone. */
async function readMeeting(ports: NoteWritePorts, meeting: VaultPath, refusals: Refusals) {
  const title = noteTitle(meeting);
  let link;
  try {
    link = await readLinkNote(ports, { note: meeting, property: MEETING_TASKS_KEY });
  } catch (error) {
    // The one refusal reading makes is a pane with unsaved typing.
    if (error instanceof ProposalRefused) throw refusals.unsaved(title);
    throw error;
  }
  if (link === null) throw new MeetingSummaryRefused(`“${title}” is not there any more.`);
  return link;
}

/** Writes the keys and body through the import's stamp writer, its refusals said as the summary's. */
async function stamped(
  ports: NoteWritePorts,
  stamp: Parameters<typeof writeStamp>[1],
  refusals: Refusals,
): Promise<void> {
  const title = noteTitle(stamp.path);
  let refused: string | null;
  try {
    refused = await writeStamp(ports, stamp);
  } catch (error) {
    if (error instanceof NoteChangedError) throw refusals.changed(title);
    throw error;
  }
  if (refused !== null) throw refusals.unsaved(title);
}
