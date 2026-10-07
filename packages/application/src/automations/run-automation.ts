import {
  messageWithoutPaths,
  type AutomationPlan,
  type AutomationRule,
  type DoneAction,
  type LogEntry,
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
import { appendToRuleLog } from './automation-log.ts';
import { planRun, type RuleQueryPorts } from './plan-run.ts';
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
  const { activity, rule } = run;
  return reported({ activity, rule, doing: 'run', carryOut: () => runOnce(run) });
}

async function runOnce({
  trigger,
  ...run
}: AutomationRun & { trigger: RunTrigger }): Promise<LogEntry> {
  const { rule, clock, guard } = run;
  const at = clock.localNow();
  const today = clock.today();
  stillInVault(guard);
  const fs = guardedFs(run.ports.fs, guard);
  const ports = { ...run.ports, fs, notePaths: await listVaultNotes({ fs }) };
  const log = (entry: LogEntry) => appendToRuleLog({ fs: run.ports.fs, rule, entry });
  let plan: AutomationPlan;
  try {
    plan = await planRun({ ports, rule, today });
  } catch (cause) {
    if (!(cause instanceof AtlasQueryError)) throw cause;
    const failed: LogEntry = { kind: 'failed', at, trigger, problem: messageWithoutPaths(cause) };
    await log(failed);
    return failed;
  }
  // The index answered for the vault open when it was asked; that must still be the rule's.
  stillInVault(guard);
  let applied: PropertyOutcome = { done: [], left: [] };
  const entry = (): LogEntry => ({
    kind: 'run',
    at,
    trigger,
    done: applied.done,
    left: [...plan.passedOver, ...applied.left],
    capped: plan.capped,
  });
  try {
    applied = await applyPlan({ ports, plan, today });
  } finally {
    // Each batch records per note and does not throw part-way, so what it returns is all it did;
    // if it throws, it threw before its first change, and the entry says it did nothing.
    await log(entry());
  }
  // Cut off by a switch: said so to the caller, once what it did is on record.
  stillInVault(guard);
  return entry();
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
  if (plan.paths.length === 0) return { done: [], left: [] };
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
    return changeProperties({ ports, changes, kind: 'set' });
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
