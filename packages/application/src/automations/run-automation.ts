import {
  automationEntryReport,
  leftHandledNotes,
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
import { withHandledKeys } from './handled-keys.ts';
import { ClaudeStepFailed, runClaudeStep, type ClaudeStepPorts } from './claude-step.ts';
import { reported } from './automation-activity.ts';
import { appendToRuleLog, readRuleLog } from './automation-log.ts';
import {
  arrivalsMissed,
  handledBy,
  handledAmong,
  handledNow,
  NoteRunsCappedError,
  planForVersions,
  planRuleNow,
  writtenBy,
  type RuleTarget,
} from './note-runs.ts';
import type { RuleQueryPorts } from './plan-run.ts';
import { guardedFs, stillInVault, type VaultGuard } from './vault-guard.ts';

/**
 * Everything a run reaches: the archive's ports, the vault's types, and what
 * a Claude step asks (P29-03). The vault's notes are read afresh by each run
 * — a scheduled run can come long after the list on screen was.
 */
export type AutomationPorts = ArchivePorts &
  Pick<RuleQueryPorts, 'types'> & { readonly claude: ClaudeStepPorts };

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
    // Run by hand, a rule notes set off does what it would have for each note not yet handled;
    // a Claude step, on any trigger, is never asked again about a version it has answered.
    const remembers = rule.when.kind === 'note' || rule.action.kind === 'claude';
    const log = remembers ? await readRuleLog(run.ports.fs, rule) : null;
    return planRuleNow({
      ports,
      rule,
      log: log?.entries ?? [],
      ledger: log?.ledger ?? null,
      today,
    });
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
 * own write left is there by then, and does not set it off again. A path a
 * note it had handled has left — deleted, moved, renamed, archived, or
 * replaced by a new note — is written down as gone, so a new note there is
 * new to it. A run that changed nothing is said in
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
  const log = await readRuleLog(run.ports.fs, run.rule);
  const { entries } = log;
  const triggering = await withHandledKeys({
    fs: run.ports.fs,
    markdown: run.ports.markdown,
    rule: run.rule,
    versions: triggeringVersions(run.when, run.changes),
  });
  const handled = await handledAmong({ index: run.ports.index, log, versions: triggering });
  const went = leftHandledNotes(run.changes, handled);
  const versions = unhandledVersions(triggering, handled);
  const heldUntil = noteRunsHeldUntil(entries, run.clock.localNow());
  if (versions.length === 0 || heldUntil !== null) {
    await recordGone(run, went);
    if (versions.length > 0 && heldUntil !== null) throw new NoteRunsCappedError(heldUntil);
    return null;
  }
  const aim: Aim = (ports, today) => planForVersions({ ports, rule: run.rule, versions, today });
  return runOnce({ run, trigger: 'note', aim, quiet: true, went });
}

/**
 * Runs a rule set off by a note being created on the arrivals it never ran
 * on (ADR-0028, "Catching up when Atlas opens"): asked once when a vault
 * opens, on the Mac that runs its automations. An arrival is heard in memory,
 * so one let in just before Atlas was quit — or held back by the hour's cap,
 * or let go — would otherwise wait for a run by hand for ever.
 *
 * It looks only where meeting files land, at meetings the import let in
 * since the rule's file was last saved and of which its log holds nothing
 * (`missedArrivals`), and runs as the feed's news would have: the same query
 * among those notes, the same most per run, the same hourly cap — rejecting
 * with `NoteRunsCappedError` when that holds it back, so the caller keeps it
 * for later as it keeps news. Settles with the log entry; null when the rule
 * is off or is not set off by `created`, nothing was missed, or there was
 * nothing to do.
 */
export async function runOnMissedArrivals(run: AutomationRun): Promise<LogEntry | null> {
  const { activity, rule } = run;
  if (!rule.enabled || rule.when.kind !== 'note' || !rule.when.on.includes('created')) return null;
  const { when } = rule;
  const carryOut = async (): Promise<LogEntry | null> => {
    stillInVault(run.guard);
    const log = await readRuleLog(run.ports.fs, rule);
    const { entries } = log;
    const { fs, index } = run.ports;
    const handled = await handledNow({ index, log });
    const versions = await arrivalsMissed({
      fs,
      markdown: run.ports.markdown,
      index,
      rule,
      trigger: when,
      handled,
    });
    if (versions.length === 0) return null;
    const heldUntil = noteRunsHeldUntil(entries, run.clock.localNow());
    if (heldUntil !== null) throw new NoteRunsCappedError(heldUntil);
    const aim: Aim = (ports, today) => planForVersions({ ports, rule, versions, today });
    return runOnce({ run, trigger: 'note', aim, quiet: true });
  };
  return reported({ activity, rule, doing: 'run', carryOut });
}

/**
 * Says that a rule held back let news go (`count` syncs' worth): in Activity
 * first, so it is said even if the log cannot be written, then in the rule's
 * log. What was let go is not lost for good: a run by hand takes every note
 * the rule has not handled.
 */
export async function recordNewsLetGo({
  ports,
  rule,
  clock,
  guard,
  activity,
  count,
}: Pick<AutomationRun, 'rule' | 'guard' | 'activity'> & {
  ports: Pick<AutomationPorts, 'fs'>;
  clock: Pick<Clock, 'localNow'>;
  count: number;
}): Promise<LogEntry> {
  stillInVault(guard);
  const entry: LogEntry = { kind: 'letGo', at: clock.localNow(), count };
  const report = automationEntryReport(rule, entry);
  if (report !== null) activity.inOpenVault().record(report);
  await appendToRuleLog({ fs: guardedFs(ports.fs, guard), rule, entry });
  return entry;
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
    // A query that does not read still heard which notes went: the history is the rule's either way.
    await recordGone(run, went);
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
  if (plan.action.kind === 'claude' && plan.paths.length > 0) {
    const asked = { run, ports, target, action: plan.action, at, trigger, went, log };
    return askClaude(asked);
  }
  let applied: PropertyOutcome = { done: [], left: [] };
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
 * Carries out a Claude step over the plan's notes (P29-03) and logs it: what
 * it made, or — when it failed, having written nothing — why, as a run that
 * could not. Either way the model it asked and how long it took are on record.
 *
 * Every note it was asked about is handled, whatever it proposed — nothing
 * included: asking again about the same version costs a model's time and says
 * the same. A failed run handles none, so a run by hand asks again; what a
 * half-written run made is on record, and the proposals it made are not made
 * twice. Past the notes one Claude run reads, the log says so and the rest
 * wait for a run by hand.
 */
async function askClaude({
  run,
  ports,
  target,
  action,
  at,
  trigger,
  went,
  log,
}: {
  run: AutomationRun;
  ports: AutomationPorts & { notePaths: readonly VaultPath[] };
  target: RuleTarget;
  action: Extract<AutomationRule['action'], { kind: 'claude' }>;
  at: string;
  trigger: RunTrigger;
  went: readonly VaultPath[];
  log: (entry: LogEntry) => Promise<void>;
}): Promise<LogEntry> {
  const { plan } = target;
  try {
    const { done, left, claude } = await runClaudeStep({
      ports: ports.claude,
      action,
      paths: plan.paths,
      fs: ports.fs,
      index: ports.index,
      markdown: ports.markdown,
      notePaths: ports.notePaths,
      rule: run.rule.id,
      madeBy: `${run.rule.name} · ${at.replace('T', ' ')}`,
    });
    const entry: LogEntry = {
      kind: 'run',
      at,
      trigger,
      done,
      left: [...plan.passedOver, ...left],
      capped: plan.capped,
      ...(target.versions !== null && { versions: askedAbout(target) }),
      ...(went.length > 0 && { went }),
      claude,
    };
    await log(entry);
    return entry;
  } catch (cause) {
    if (!(cause instanceof ClaudeStepFailed)) throw cause;
    const failed: LogEntry = {
      kind: 'failed',
      at,
      trigger,
      // Already without this machine's paths; stripped again, a fix's URL would be taken for one.
      problem: cause.message,
      claude: cause.claude,
      ...(cause.made.length > 0 && { done: cause.made }),
    };
    await recordGone(run, went);
    await log(failed);
    // Stopped by something other than the answer — a disk that refused — is raised once it is on record.
    if (cause.interruption !== undefined) throw cause.interruption;
    return failed;
  }
}

/** The versions of the notes a Claude step was asked about: each handled, as it was read. */
function askedAbout({ plan, versions }: RuleTarget): LoggedVersion[] {
  const asked = new Set<string>(plan.paths);
  return (versions ?? [])
    .filter((version) => asked.has(version.path))
    .map((version) => ({ ...version, wrote: false }));
}

/**
 * The versions a note-triggered run records: those it acted on, and those its
 * writes left. Read through the rule's own vault's files, as its log is written.
 */
async function versionsOf(
  run: AutomationRun,
  versions: readonly NoteVersionRef[],
  { done }: PropertyOutcome,
): Promise<LoggedVersion[]> {
  const handled = handledBy(versions, done);
  try {
    return [...handled, ...(await writtenBy({ fs: run.ports.fs, done }))];
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
}): Promise<PropertyOutcome> {
  const { action } = plan;
  // A Claude step with notes to read is asked before this; with none, it does nothing.
  if (plan.paths.length === 0 || action.kind === 'claude') return { done: [], left: [] };
  if (action.kind === 'set') {
    const changes = plan.paths.flatMap((path) =>
      Object.entries(action.values).map(([key, value]) => ({
        path,
        key,
        expect: null,
        to: { value },
      })),
    );
    return changeProperties({ ports, changes, kind: 'set', today });
  }
  const outcome = await archiveNotes({
    ports,
    paths: plan.paths,
    notePaths: ports.notePaths,
    today,
    updateLinks: true,
    unsavedTyping: 'leave',
  });
  return archiveRecord(outcome, 'archived');
}

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
