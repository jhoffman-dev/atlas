import {
  digestOf,
  foldedVaultPath,
  lastUndoableRun,
  loggedActionProblem,
  madeTaskMeeting,
  splitFrontmatter,
  unarchiveProblem,
  type DoneAction,
  type LogEntry,
  type PassedOver,
  type VaultPath,
} from '@atlas/domain';
import { unarchiveNotes } from '../archive/archive-notes.ts';
import {
  MeetingSummaryRefused,
  undoMeetingSummary,
  type SummaryToTakeBack,
} from '../meetings/write-meeting-summary.ts';
import { homeFolderFor } from '../notes/home-folder.ts';
import {
  changeProperties,
  UNSAVED_TYPING,
  type PropertyChange,
  type PropertyOutcome,
} from './apply-changes.ts';
import { appendForRun, reported } from './automation-activity.ts';
import { readRuleLog } from './automation-log.ts';
import { archiveRecord, type AutomationPorts, type AutomationRun } from './run-automation.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { guardedFs, stillInVault } from './vault-guard.ts';

const MOVED_SINCE = 'It is no longer where the run put it, so it was left where it is.';

type Run = Extract<LogEntry, { kind: 'run' }>;
type UndoPorts = AutomationPorts & { notePaths: readonly VaultPath[] };

/**
 * Undoes a rule's last run (P25-02), from what its log says it did: each note
 * it archived goes back where it was, and each property it set goes back to
 * what it held — unless it has changed since, which is left as it is and said
 * so. Settles with the undo's log entry, or null when there is no run to undo.
 *
 * The log is a note anyone could have written (A25-01), so a line is carried
 * out only when this rule's own action could have done it, to a value a
 * property could hold, and — for an archived note — only while the note's
 * archive stamp is the run's. Every other line is left, and named.
 *
 * What the undo did, or why it stopped, goes to the Activity log too.
 */
export async function undoLastRun(run: AutomationRun): Promise<LogEntry | null> {
  const { activity, rule } = run;
  return reported({ activity, rule, doing: 'undo', carryOut: () => undoOnce(run) });
}

async function undoOnce(run: AutomationRun): Promise<LogEntry | null> {
  const { rule, clock, guard } = run;
  stillInVault(guard);
  const fs = guardedFs(run.ports.fs, guard);
  const ports = { ...run.ports, fs, notePaths: await listVaultNotes({ fs }) };
  const last = lastUndoableRun((await readRuleLog(ports.fs, rule)).entries);
  if (last === null) return null;
  const at = clock.localNow();

  const refused: PassedOver[] = [];
  const trusted = last.done.filter((line) => {
    const problem = loggedActionProblem(rule.action, line);
    if (problem !== null)
      refused.push({ path: 'path' in line ? line.path : line.to, reason: problem });
    return problem === null;
  });
  let archived: PropertyOutcome = { done: [], left: [] };
  let restored: PropertyOutcome = { done: [], left: [] };
  let summaries: PropertyOutcome = { done: [], left: [] };
  const entry = (): LogEntry => ({
    kind: 'undo',
    at,
    of: last.at,
    done: [...archived.done, ...restored.done, ...summaries.done],
    left: [...refused, ...archived.left, ...restored.left, ...summaries.left],
  });
  try {
    archived = await putBack({ ports, run: last, done: trusted });
    restored = await changeProperties({
      ports,
      changes: restoringChanges(trusted),
      kind: 'restored',
      today: clock.today(),
    });
    summaries = await takeBackSummaries({ ports, run: last, done: trusted });
  } finally {
    // As a run does: what the undo changed is logged however it ends, in the rule's own vault.
    await appendForRun({ fs: run.ports.fs, run, entry: entry() });
  }
  stillInVault(guard);
  return entry();
}

/**
 * Takes the notes the run archived out of the Archive: those still where it
 * put them, stamped as archived by it.
 */
async function putBack({
  ports,
  run,
  done,
}: {
  ports: UndoPorts;
  run: Run;
  done: readonly DoneAction[];
}): Promise<PropertyOutcome> {
  const archived = done.flatMap((action) => (action.kind === 'archived' ? [action] : []));
  if (archived.length === 0) return { done: [], left: [] };
  const present = new Set(ports.notePaths.map(foldedVaultPath));
  const left: PassedOver[] = archived
    .filter(({ to }) => !present.has(foldedVaultPath(to)))
    .map(({ to }) => ({ path: to, reason: MOVED_SINCE }));
  const there = archived.filter(({ to }) => present.has(foldedVaultPath(to)));
  const stamps = await stampsOf(
    ports,
    there.map(({ to }) => to),
  );
  const ours: VaultPath[] = [];
  for (const { from, to } of there) {
    const problem = unarchiveProblem({ runAt: run.at, from, properties: stamps.get(to) ?? {} });
    if (problem === null) ours.push(to);
    else left.push({ path: to, reason: problem });
  }
  const outcome =
    ours.length === 0
      ? { moves: [], failed: [], linksUpdated: 0 }
      : await unarchiveNotes({
          ports,
          paths: ours,
          notePaths: ports.notePaths,
          updateLinks: true,
          unsavedTyping: 'leave',
        });
  const record = archiveRecord(outcome, 'unarchived');
  return { done: record.done, left: [...left, ...record.left] };
}

/** Each note's frontmatter, as its archive stamp is read from. */
async function stampsOf(
  ports: UndoPorts,
  paths: readonly VaultPath[],
): Promise<Map<string, Readonly<Record<string, unknown>>>> {
  const files = await ports.fs.readNotes(paths);
  return new Map(
    files.map((file) => [
      file.path,
      ports.markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter),
    ]),
  );
}

/** Each property the run set, back to what it held — while it still holds what the run left. */
function restoringChanges(done: readonly DoneAction[]): PropertyChange[] {
  return done.flatMap((action): PropertyChange[] =>
    action.kind === 'set'
      ? [{ path: action.path, key: action.key, expect: action.after, to: action.before }]
      : [],
  );
}

const CHANGED_SINCE = 'It was changed since the run made it, so it was kept.';
const NOT_THERE = 'It is no longer where the run made it, so it was left.';
const meetingKept = (reason: string) => `Its meeting was left as it is, so it was kept: ${reason}`;

/** A task the run made, unchanged since, and the meeting it is from. */
interface MadeTask {
  readonly path: VaultPath;
  readonly meeting: VaultPath;
}

/**
 * Takes back what the declared step wrote (#185), one meeting at a time:
 * first the meeting — its summary block out, or back to the one it replaced,
 * and the links to its tasks — in one write, then each of its tasks to the
 * Trash. A task changed since stays, and so does its link. A meeting that
 * refuses (its block edited since, typed in, changed meanwhile) is left, and
 * so is every task of it: no link names a trashed note, and no summary says
 * a task was made that is gone. A logged task undo cannot believe the run
 * made (A25-01) is left, and named.
 */
async function takeBackSummaries({
  ports,
  run,
  done,
}: {
  ports: UndoPorts;
  run: Run;
  done: readonly DoneAction[];
}): Promise<PropertyOutcome> {
  const summaries = new Map<VaultPath, SummaryToTakeBack>();
  for (const action of done) {
    if (action.kind === 'summarised') summaries.set(action.path, action);
  }
  const { made, left } = await madeTasks({ ports, run, done, meetings: [...summaries.keys()] });
  const meetings = [...new Set([...summaries.keys(), ...made.map(({ meeting }) => meeting)])];
  const did: DoneAction[] = [];
  for (const meeting of meetings) {
    const trashing = made.filter((task) => task.meeting === meeting).map(({ path }) => path);
    const summary = summaries.get(meeting) ?? null;
    try {
      await undoMeetingSummary(ports, { meeting, summary, trashing, notePaths: ports.notePaths });
    } catch (cause) {
      if (!(cause instanceof MeetingSummaryRefused)) throw cause;
      if (summary !== null) left.push({ path: meeting, reason: cause.message });
      left.push(...trashing.map((path) => ({ path, reason: meetingKept(cause.message) })));
      continue;
    }
    for (const path of trashing) {
      await ports.fs.trashEntry({ path });
      did.push({ kind: 'trashed', path });
    }
    if (summary !== null) did.push({ kind: 'unsummarised', path: meeting });
  }
  return { done: did, left };
}

/**
 * The tasks the run's log says it made that undo may trash: each still as
 * made, and one the run could have made — a task from a meeting it read, in
 * the folder it made tasks in. The rest are left, with why.
 */
async function madeTasks({
  ports,
  run,
  done,
  meetings,
}: {
  ports: UndoPorts;
  run: Run;
  done: readonly DoneAction[];
  /** The meetings the run wrote a summary to: read by it, whatever its tallies say. */
  meetings: readonly VaultPath[];
}): Promise<{ made: MadeTask[]; left: PassedOver[] }> {
  const runMeetings = [...meetings, ...(run.claude?.meetings ?? []).map(({ path }) => path)];
  const made: MadeTask[] = [];
  const left: PassedOver[] = [];
  for (const action of done) {
    if (action.kind !== 'created' || action.digest === undefined) continue;
    const { path, digest } = action;
    const read = await readUnchangedTask(ports, path, digest);
    if (!read.ok) {
      left.push({ path, reason: read.reason });
      continue;
    }
    const properties = ports.markdown.frontmatterProperties(
      splitFrontmatter(read.text).frontmatter,
    );
    const home = await homeFolderFor({
      fs: ports.fs,
      markdown: ports.markdown,
      properties,
      today: run.at.slice(0, 10),
    });
    const ours = madeTaskMeeting({
      path,
      properties,
      runMeetings,
      notePaths: ports.notePaths,
      home,
    });
    if (ours.ok) made.push({ path, meeting: ours.meeting });
    else left.push({ path, reason: ours.reason });
  }
  return { made, left };
}

/** A task the run made, as it is now — or why it is not to be trashed: typed in, changed since, or gone. */
async function readUnchangedTask(
  ports: UndoPorts,
  path: VaultPath,
  digest: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (ports.editors.state(path) === 'dirty') return { ok: false, reason: UNSAVED_TYPING };
  const [file] = await ports.fs.readNotes([path]);
  if (file === undefined) return { ok: false, reason: NOT_THERE };
  return digestOf(file.text) === digest
    ? { ok: true, text: file.text }
    : { ok: false, reason: CHANGED_SINCE };
}
