import {
  automationEntryReport,
  automationFailedReport,
  ledgerRepairedReport,
  messageWithoutPaths,
  type LogEntry,
  type RuleNamed,
} from '@atlas/domain';
import type { Clock } from '../ports.ts';
import type { ActivityLog } from '../activity/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { appendToRuleLog } from './automation-log.ts';
import { VaultChangedError } from './vault-guard.ts';

/**
 * Carries out a run or an undo, and says in the Activity log how it went:
 * the summary its rule's log was given, or why it stopped. A run cut off by
 * another vault opening is not the rule's failure, and the log open now is
 * that other vault's, so it is not recorded.
 */
export async function reported<Entry extends LogEntry | null>({
  activity,
  rule,
  doing,
  carryOut,
}: {
  activity: ActivityLog;
  rule: RuleNamed;
  doing: 'run' | 'undo';
  carryOut: () => Promise<Entry>;
}): Promise<Entry> {
  // Taken before the work waits, so its line lands in its own vault's log.
  const recorder = activity.inOpenVault();
  let entry: Entry;
  try {
    entry = await carryOut();
  } catch (cause) {
    if (!(cause instanceof VaultChangedError)) {
      recorder.record(automationFailedReport({ rule, doing, problem: messageWithoutPaths(cause) }));
    }
    throw cause;
  }
  const report = entry === null ? null : automationEntryReport(rule, entry);
  if (report !== null) recorder.record(report);
  return entry;
}

/**
 * Adds an entry to a rule's log, dated by the run's clock, and says in
 * Activity — once, as it is rebuilt — if the rule's handled ledger had to be.
 */
export function appendForRun({
  fs,
  run,
  entry,
}: {
  fs: VaultFsPort;
  run: { rule: RuleNamed & { id: string }; clock: Pick<Clock, 'now'>; activity: ActivityLog };
  entry: LogEntry;
}): Promise<void> {
  // Taken before the write waits, so its line lands in its own vault's log.
  const recorder = run.activity.inOpenVault();
  return appendToRuleLog({
    fs,
    rule: run.rule,
    entry,
    now: run.clock.now(),
    onLedgerRepaired: () => recorder.record(ledgerRepairedReport(run.rule)),
  });
}
