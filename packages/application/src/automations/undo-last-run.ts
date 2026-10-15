import {
  digestOf,
  foldedVaultPath,
  lastUndoableRun,
  loggedActionProblem,
  splitFrontmatter,
  unarchiveProblem,
  type DoneAction,
  type LogEntry,
  type PassedOver,
  type VaultPath,
} from '@atlas/domain';
import { unarchiveNotes } from '../archive/archive-notes.ts';
import { MeetingSummaryRefused, undoMeetingSummary } from '../meetings/write-meeting-summary.ts';
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
    summaries = await takeBackSummaries({ ports, done: trusted });
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

/**
 * Takes back what the declared step wrote (#185): each task it made, to the
 * Trash, while it is still exactly as made; then each meeting's summary
 * block and keys, while the block is still the one written, with the links
 * to the tasks trashed. A task changed since stays, and so does its link; a
 * block edited since stays, and so does the meeting.
 */
async function takeBackSummaries({
  ports,
  done,
}: {
  ports: UndoPorts;
  done: readonly DoneAction[];
}): Promise<PropertyOutcome> {
  const tasks = done.flatMap((action) =>
    action.kind === 'created' && action.digest !== undefined ? [action] : [],
  );
  const meetings = done.flatMap((action) => (action.kind === 'summarised' ? [action] : []));
  const did: DoneAction[] = [];
  const left: PassedOver[] = [];
  for (const { path, digest } of tasks) {
    const problem = await unchangedTaskProblem(ports, path, digest!);
    if (problem !== null) {
      left.push({ path, reason: problem });
      continue;
    }
    await ports.fs.trashEntry({ path });
    did.push({ kind: 'trashed', path });
  }
  const trashed = did.map((action) => ('path' in action ? action.path : action.to));
  for (const { path, digest } of meetings) {
    try {
      await undoMeetingSummary(ports, {
        meeting: path,
        digest,
        trashed,
        notePaths: ports.notePaths,
      });
      did.push({ kind: 'unsummarised', path });
    } catch (cause) {
      if (!(cause instanceof MeetingSummaryRefused)) throw cause;
      left.push({ path, reason: cause.message });
    }
  }
  return { done: did, left };
}

/** Why a task the run made is not to be trashed: typed in, changed since, or gone; null when it is as made. */
async function unchangedTaskProblem(
  ports: UndoPorts,
  path: VaultPath,
  digest: string,
): Promise<string | null> {
  if (ports.editors.state(path) === 'dirty') return UNSAVED_TYPING;
  const [file] = await ports.fs.readNotes([path]);
  if (file === undefined) return NOT_THERE;
  return digestOf(file.text) === digest ? null : CHANGED_SINCE;
}
