import {
  decideMeetingItems,
  linkedTaskOwner,
  linkTargets,
  MEETING_TASKS_KEY,
  meetingReview,
  messageWithoutPaths,
  resolveWikiLinkTarget,
  splitFrontmatter,
  TASK_KEYS,
  type CheckedProposal,
  type DoneAction,
  type LinkedTask,
  type MadeItem,
  type MeetingItemsDecision,
  type MeetingItemsRun,
  type OwnerSettings,
  type VaultPath,
} from '@atlas/domain';
import { ProposalRefused } from '../chat/proposals.ts';
import type { IndexPort } from '../index/ports.ts';
import {
  makeTaskFromMeeting,
  type MeetingItemTask,
  type TaskMeeting,
} from '../meetings/make-task-from-meeting.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { NoteWritePorts } from '../proposals/proposal-writes.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What reading a meeting's run, and making its tasks, reaches. */
export interface OwnersTasksPorts extends NoteWritePorts {
  readonly index: Pick<IndexPort, 'query'>;
}

/** One of the owner's items, ready to be made a task of its meeting. */
export interface PlannedTask {
  readonly meeting: TaskMeeting;
  readonly item: MeetingItemTask;
}

/**
 * What the declared step decided for one meeting: the tasks to make, the one
 * review proposal of what the owner should still see (#226), and how many
 * items were left out.
 */
export interface MeetingDecided {
  readonly meeting: VaultPath;
  readonly tasks: readonly PlannedTask[];
  /** The meeting's review, when anything is left to review: never more than one. */
  readonly proposals: readonly CheckedProposal[];
  /** The items that reach the owner nowhere: not theirs, or not sure enough. */
  readonly leftOut: number;
  /** Why none of the meeting's items could be a task, when that is the meeting's, not an item's. */
  readonly noTasksBecause: MeetingItemsDecision['noTasksBecause'];
}

/**
 * Decides what becomes of one meeting's items (`decideMeetingItems`, #178):
 * the owner's tasks to make, and the rest the owner should see gathered into
 * the meeting's one review (`meetingReview`, #226). What the run knows beyond
 * the answer is read from the meeting as it is now — its `tasks`, and when
 * it arrived — never from the model.
 */
export async function decideForMeeting({
  ports,
  meeting,
  proposals,
  owner,
  made,
  ruleSince,
  notePaths,
  today,
}: {
  ports: Pick<OwnersTasksPorts, 'fs' | 'markdown'>;
  meeting: VaultPath;
  proposals: readonly CheckedProposal[];
  owner: OwnerSettings;
  made: readonly MadeItem[];
  /** When the rule's file was last written; null when it could not be read. */
  ruleSince: number | null;
  notePaths: readonly VaultPath[];
  today: string;
}): Promise<MeetingDecided> {
  const [file] = await ports.fs.readNotes([meeting]);
  const properties =
    file === undefined
      ? {}
      : ports.markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
  const run: MeetingItemsRun = {
    today,
    // A meeting that arrived before the rule's own file is a backfill: proposals only (ADR-0036).
    backfilled: ruleSince === null || file === undefined || file.modified <= ruleSince,
    madeItems: made,
    linkedTasks: await readLinkedTasks({ ports, value: properties[MEETING_TASKS_KEY], notePaths }),
  };
  const decision = decideMeetingItems({ proposals, vault: owner, run });
  const tasks: PlannedTask[] = [];
  const rest: CheckedProposal[] = [];
  let leftOut = 0;
  for (const { proposal, decision: each } of decision.items) {
    if (each.outcome === 'skipped') continue;
    if (each.outcome === 'left-out') {
      leftOut += 1;
      continue;
    }
    if (
      each.outcome === 'proposal' ||
      !isTaskKind(proposal.kind) ||
      proposal.cites.meeting === null
    ) {
      rest.push(proposal);
      continue;
    }
    tasks.push({
      meeting: { path: proposal.cites.note, identity: proposal.cites.meeting },
      item: {
        kind: proposal.kind,
        title: each.payload.title,
        folder: each.payload.folder,
        properties: each.payload.properties,
        body: each.payload.body,
        source: proposal.source,
        atlasItem: each.atlasItem,
      },
    });
  }
  const review = meetingReview(rest);
  return {
    meeting,
    tasks,
    proposals: review === null ? [] : [review],
    leftOut,
    noTasksBecause: decision.noTasksBecause,
  };
}

const isTaskKind = (kind: string): kind is MeetingItemTask['kind'] =>
  kind === 'task' || kind === 'follow-up';

/**
 * The tasks the meeting's `tasks` links to, as far as skipping an item goes:
 * the block each cites, and whose it is. A link to no note is no task.
 */
async function readLinkedTasks({
  ports,
  value,
  notePaths,
}: {
  ports: {
    fs: Pick<VaultFsPort, 'readNotes'>;
    markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
  };
  value: unknown;
  notePaths: readonly VaultPath[];
}): Promise<LinkedTask[]> {
  const written = (Array.isArray(value) ? value : [value]).filter(
    (each): each is string => typeof each === 'string',
  );
  const paths = written
    .flatMap((each) => linkTargets(each))
    .flatMap((target) => resolveWikiLinkTarget(target, notePaths) ?? []);
  if (paths.length === 0) return [];
  const notes = await ports.fs.readNotes([...new Set(paths)]);
  return notes.map((note) => {
    const properties = ports.markdown.frontmatterProperties(
      splitFrontmatter(note.text).frontmatter,
    );
    const source = properties[TASK_KEYS.source];
    return {
      source: typeof source === 'string' ? source : '',
      owner: linkedTaskOwner(properties),
    };
  });
}

/**
 * Making the tasks stopped part-way: the tasks made before it stay, and are
 * named, so the log says them; the rest are made once on a retry, which finds
 * these by their `atlas_item`.
 */
export class OwnersTasksStopped extends Error {
  constructor(
    readonly made: readonly DoneAction[],
    readonly planned: number,
    readonly reason: unknown,
  ) {
    super(
      `Made ${made.length} of ${planned} ${planned === 1 ? 'task' : 'tasks'}, then one could not be made: ${messageWithoutPaths(reason)}`,
    );
    this.name = 'OwnersTasksStopped';
  }

  /** Whether what stopped it is a refusal in words — the meeting was edited, typed in, or archived — rather than a fault. */
  get refused(): boolean {
    return this.reason instanceof ProposalRefused;
  }
}

/**
 * Makes each planned task, linked both ways (`makeTaskFromMeeting`, #177),
 * one after another. The vault's notes grow with each, so no two take one
 * name. Rejects with {@link OwnersTasksStopped} when one cannot be made.
 */
export async function makeOwnersTasks({
  ports,
  tasks,
  notePaths,
  today,
}: {
  ports: NoteWritePorts;
  tasks: readonly PlannedTask[];
  notePaths: readonly VaultPath[];
  today: string;
}): Promise<DoneAction[]> {
  const made: DoneAction[] = [];
  const paths = [...notePaths];
  for (const { meeting, item } of tasks) {
    try {
      const { task } = await makeTaskFromMeeting({ ports, meeting, item, notePaths: paths, today });
      paths.push(task);
      made.push({ kind: 'created', path: task });
    } catch (reason) {
      throw new OwnersTasksStopped(made, tasks.length, reason);
    }
  }
  return made;
}
