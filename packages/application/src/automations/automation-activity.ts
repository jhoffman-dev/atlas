import {
  automationEntryReport,
  automationFailedReport,
  messageWithoutPaths,
  type LogEntry,
  type RuleNamed,
} from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
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
