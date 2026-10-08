import {
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
import { changeProperties, type PropertyChange, type PropertyOutcome } from './apply-changes.ts';
import { reported } from './automation-activity.ts';
import { appendToRuleLog, readRuleLog } from './automation-log.ts';
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
  const entry = (): LogEntry => ({
    kind: 'undo',
    at,
    of: last.at,
    done: [...archived.done, ...restored.done],
    left: [...refused, ...archived.left, ...restored.left],
  });
  try {
    archived = await putBack({ ports, run: last, done: trusted });
    restored = await changeProperties({
      ports,
      changes: restoringChanges(trusted),
      kind: 'restored',
    });
  } finally {
    // As a run does: what the undo changed is logged however it ends, in the rule's own vault.
    await appendToRuleLog({ fs: run.ports.fs, rule, entry: entry() });
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
      ? { moves: [], failed: [], linksUpdated: 0, relinked: [] }
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
