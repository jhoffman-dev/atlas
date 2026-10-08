import {
  deletedHandledNotes,
  handledVersions,
  messageWithoutPaths,
  noteRunsHeldUntil,
  noteTriggerHears,
  triggeringVersions,
  unhandledVersions,
  type AutomationPlan,
  type AutomationRule,
  type DoneAction,
  type LoggedVersion,
  type LogEntry,
  type NoteChange,
  type NoteTrigger,
  type NoteVersionRef,
  type PassedOver,
  type RunTrigger,
  type VaultPath,
} from '@atlas/domain';
import { archiveNotes, type ArchiveOutcome, type ArchivePorts } from '../archive/archive-notes.ts';
import type { ActivityLog } from '../activity/ports.ts';
import type { Clock } from '../ports.ts';
import { AtlasQueryError } from '../query/run-atlas-query.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { changeProperties, type PropertyOutcome } from './apply-changes.ts';
import { reported } from './automation-activity.ts';
import { appendToRuleLog, readRuleLog } from './automation-log.ts';
import {
  handledBy,
  NoteRunsCappedError,
  planForVersions,
  planRuleNow,
  writtenBy,
  type RuleTarget,
} from './note-runs.ts';
import type { RuleQueryPorts } from './plan-run.ts';
import { guardedFs, stillInVault, type VaultGuard } from './vault-guard.ts';

/**
 * Everything a run reaches: the archive's ports, and the vault's types. The
 * vault's notes are read afresh by each run — a scheduled run can come long
 * after the list on screen was.
 */
export type AutomationPorts = ArchivePorts & Pick<RuleQueryPorts, 'types'>;

export interface AutomationRun {
  readonly ports: AutomationPorts;
  readonly rule: AutomationRule;
  readonly clock: Pick<Clock, 'today' | 'localNow'>;
  readonly guard: VaultGuard;
  /** Where the run's summary, or why it stopped, is said (U-28). */
  readonly activity: ActivityLog;
}

/**
 * Runs a rule once (P25-02): plans what it would do today, carries the plan
 * out, and logs exactly what happened — a run whose query does not read is
 * logged as one that could not run. Settles with the log entry.
 *
 * The runner decides nothing: which notes, and what to do with each, is the
 * plan's. It only refuses what it must — a note being typed in, a vault that
 * is no longer the one open — and says so.
 *
 * Whatever it changed is logged, even when the run is cut off (A25-01): the
 * entry is written however applying the plan ends. It goes through the rule's
 * own vault's files, not the guarded ones — the guard stops further changes,
 * not the record of those already made; the host still refuses a write once
 * that vault is closed. A log that cannot be written rejects with
 * `AutomationLogError`, carrying what the run did.
 *
 * The run's summary, or why it stopped, goes to the Activity log too.
 */
export async function runAutomation(
  run: AutomationRun & { trigger: RunTrigger },
): Promise<LogEntry> {
  const { activity, rule, trigger } = run;
  const aim: Aim = async (ports, today) => {
    // Run by hand, a rule notes set off does what it would have for each note not yet handled.
    const log = rule.when.kind === 'note' ? (await readRuleLog(run.ports.fs, rule)).entries : [];
    return planRuleNow({ ports, rule, log, today });
  };
  // Not quiet, it always settles with its entry.
  const carryOut = async () => (await runOnce({ run, trigger, aim, quiet: false }))!;
  return reported({ activity, rule, doing: 'run', carryOut });
}

/**
 * Runs a rule set off by notes (P29-01) for one sync's changes: the notes of
 * its type that arrived or changed and that its query matches, each version
 * once. Settles with the log entry; null when there was nothing it had not
 * already handled, or nothing to do — such a run writes nothing and says nothing.
 *
 * Its log is read afresh, after any run before it has written: a version its
 * own write left is there by then, and does not set it off again. A note of
 * its type it had handled that was deleted is written down as gone, so a new
 * note at that path is new to it. A run that changed nothing is said in
 * Activity but kept out of the log, and out of the hourly count. A rule
 * that has run as often this hour as one may rejects with
 * `NoteRunsCappedError` instead, and runs nothing.
 *
 * The guard names the vault the changes were heard in: run after another
 * vault was opened, it stops before reading or writing anything.
 */
export async function runOnNoteChanges(
  run: AutomationRun & { changes: readonly NoteChange[] },
): Promise<LogEntry | null> {
  const { activity, rule, changes } = run;
  if (!rule.enabled || rule.when.kind !== 'note' || !noteTriggerHears(rule.when, changes)) {
    return null;
  }
  const { when } = rule;
  const carryOut = () => runOnHeard({ ...run, when });
  return reported({ activity, rule, doing: 'run', carryOut });
}

async function runOnHeard(
  run: AutomationRun & { changes: readonly NoteChange[]; when: NoteTrigger },
): Promise<LogEntry | null> {
  stillInVault(run.guard);
  const { entries } = await readRuleLog(run.ports.fs, run.rule);
  const handled = handledVersions(entries);
  const went = deletedHandledNotes(run.when, run.changes, handled);
  const versions = unhandledVersions(triggeringVersions(run.when, run.changes), handled);
  const heldUntil = noteRunsHeldUntil(entries, run.clock.localNow());
  if (versions.length === 0 || heldUntil !== null) {
    await recordGone(run, went);
    if (versions.length > 0 && heldUntil !== null) throw new NoteRunsCappedError(heldUntil);
    return null;
  }
  const aim: Aim = (ports, today) => planForVersions({ ports, rule: run.rule, versions, today });
  return runOnce({ run, trigger: 'note', aim, quiet: true, went });
}

/** Writes down notes a rule had handled that were deleted, in an entry of their own; none, nothing. */
async function recordGone(run: AutomationRun, went: readonly VaultPath[]): Promise<void> {
  if (went.length === 0) return;
  const entry: LogEntry = {
    kind: 'run',
    at: run.clock.localNow(),
    trigger: 'note',
    done: [],
    left: [],
    capped: false,
    went,
  };
  await appendToRuleLog({ fs: guardedFs(run.ports.fs, run.guard), rule: run.rule, entry });
}

/** What a run plans over, once the vault's notes are listed. Rejects as `planRun` does. */
type Aim = (
  ports: AutomationPorts & { notePaths: readonly VaultPath[] },
  today: string,
) => Promise<RuleTarget>;

async function runOnce({
  run,
  trigger,
  aim,
  quiet,
  went = [],
}: {
  run: AutomationRun;
  trigger: RunTrigger;
  aim: Aim;
  /**
   * Whether a run that changed nothing stays out of the log: one notes set
   * off, on every save. With nothing to do it says nothing at all.
   */
  quiet: boolean;
  /** Notes the rule had handled that were deleted, for its log to say. */
  went?: readonly VaultPath[];
}): Promise<LogEntry | null> {
  const { rule, clock, guard } = run;
  const at = clock.localNow();
  const today = clock.today();
  stillInVault(guard);
  const fs = guardedFs(run.ports.fs, guard);
  const ports = { ...run.ports, fs, notePaths: await listVaultNotes({ fs }) };
  const log = (entry: LogEntry) => appendToRuleLog({ fs: run.ports.fs, rule, entry });
  let target: RuleTarget;
  try {
    target = await aim(ports, today);
  } catch (cause) {
    if (!(cause instanceof AtlasQueryError)) throw cause;
    const failed: LogEntry = { kind: 'failed', at, trigger, problem: messageWithoutPaths(cause) };
    await log(failed);
    return failed;
  }
  // The index answered for the vault open when it was asked; that must still be the rule's.
  stillInVault(guard);
  const { plan } = target;
  if (quiet && plan.paths.length === 0 && plan.passedOver.length === 0) {
    await recordGone(run, went);
    return null;
  }
  let applied: Applied = { done: [], left: [], relinked: [] };
  let versions: LoggedVersion[] = [];
  const entry = (): LogEntry => ({
    kind: 'run',
    at,
    trigger,
    done: applied.done,
    left: [...plan.passedOver, ...applied.left],
    capped: plan.capped,
    ...(target.versions !== null && { versions }),
    ...(went.length > 0 && { went }),
  });
  try {
    applied = await applyPlan({ ports, plan, today });
  } finally {
    // Each batch records per note and does not throw part-way, so what it returns is all it did;
    // if it throws, it threw before its first change, and the entry says it did nothing.
    if (target.versions !== null) versions = await versionsOf(run, target.versions, applied);
    if (!quiet || applied.done.length > 0 || went.length > 0) await log(entry());
  }
  // Cut off by a switch: said so to the caller, once what it did is on record.
  stillInVault(guard);
  return entry();
}

/**
 * The versions a note-triggered run records: those it acted on, and those its
 * writes left. Read through the rule's own vault's files, as its log is written.
 */
async function versionsOf(
  run: AutomationRun,
  versions: readonly NoteVersionRef[],
  { done, relinked }: Applied,
): Promise<LoggedVersion[]> {
  const handled = handledBy(versions, done);
  try {
    return [...handled, ...(await writtenBy({ fs: run.ports.fs, done, relinked }))];
  } catch {
    // Safe to go without: the log must still be written. A write heard back then sets the rule
    // off once more, and finds its note already as the rule leaves it — or archived, out of reach.
    return handled;
  }
}

async function applyPlan({
  ports,
  plan,
  today,
}: {
  ports: AutomationPorts & { notePaths: readonly VaultPath[] };
  plan: AutomationPlan;
  today: string;
}): Promise<Applied> {
  if (plan.paths.length === 0) return { done: [], left: [], relinked: [] };
  const { action } = plan;
  if (action.kind === 'set') {
    const changes = plan.paths.flatMap((path) =>
      Object.entries(action.values).map(([key, value]) => ({
        path,
        key,
        expect: null,
        to: { value },
      })),
    );
    return { ...(await changeProperties({ ports, changes, kind: 'set' })), relinked: [] };
  }
  const outcome = await archiveNotes({
    ports,
    paths: plan.paths,
    notePaths: ports.notePaths,
    today,
    updateLinks: true,
    unsavedTyping: 'leave',
  });
  return { ...archiveRecord(outcome, 'archived'), relinked: outcome.relinked };
}

/** What carrying a plan out did: each note done and left, and each note an archive rewrote links in. */
type Applied = PropertyOutcome & { readonly relinked: readonly VaultPath[] };

/**
 * What a batch of moves did, as log lines: each move, and each note it could
 * not move — why, without this machine's paths, since any tool can read the log.
 */
export function archiveRecord(
  outcome: ArchiveOutcome,
  kind: 'archived' | 'unarchived',
): { done: DoneAction[]; left: PassedOver[] } {
  return {
    done: outcome.moves.map(({ move }) => ({ kind, from: move.from, to: move.to })),
    left: outcome.failed.map(({ path, reason }) => ({ path, reason: messageWithoutPaths(reason) })),
  };
}
