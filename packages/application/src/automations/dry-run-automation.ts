import {
  dryRunReport,
  messageWithoutPaths,
  type AutomationPlan,
  type AutomationRule,
  type LogEntry,
  type RuleNamed,
} from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import { planRuleNow } from './note-runs.ts';
import type { RuleQueryPorts } from './plan-run.ts';

/**
 * A dry run from the rule's editor (P25-03): what the rule would do today,
 * with nothing written — and a line in the Activity log saying so, or why its
 * query did not read. For a rule notes set off, the notes that would set it
 * off now: those its query matches that it has not handled as they are
 * (P29-01). Rejects as `planRun` does.
 */
export async function dryRunAutomation({
  ports,
  rule,
  log,
  named,
  today,
  activity,
}: {
  ports: RuleQueryPorts;
  rule: Pick<AutomationRule, 'when' | 'which' | 'olderThanDays' | 'action'>;
  /** The rule's log, for what it has handled; empty for a rule not yet saved. */
  log: readonly LogEntry[];
  /** The rule's name, and its file once it has one. */
  named: RuleNamed;
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
  activity: ActivityLog;
}): Promise<AutomationPlan> {
  // Taken before the plan waits, so its line lands in its own vault's log.
  const recorder = activity.inOpenVault();
  try {
    const { plan } = await planRuleNow({ ports, rule, log, today });
    recorder.record(dryRunReport(named, { plan }));
    return plan;
  } catch (cause) {
    recorder.record(dryRunReport(named, { problem: messageWithoutPaths(cause) }));
    throw cause;
  }
}
