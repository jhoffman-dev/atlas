import {
  dryRunReport,
  messageWithoutPaths,
  type AutomationPlan,
  type AutomationRule,
  type RuleNamed,
} from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import { planRun, type RuleQueryPorts } from './plan-run.ts';

/**
 * A dry run from the rule's editor (P25-03): what the rule would do today,
 * with nothing written — and a line in the Activity log saying so, or why its
 * query did not read. Rejects as `planRun` does.
 */
export async function dryRunAutomation({
  ports,
  rule,
  named,
  today,
  activity,
}: {
  ports: RuleQueryPorts;
  rule: Pick<AutomationRule, 'which' | 'olderThanDays' | 'action'>;
  /** The rule's name, and its file once it has one. */
  named: RuleNamed;
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
  activity: ActivityLog;
}): Promise<AutomationPlan> {
  // Taken before the plan waits, so its line lands in its own vault's log.
  const recorder = activity.inOpenVault();
  try {
    const plan = await planRun({ ports, rule, today });
    recorder.record(dryRunReport(named, { plan }));
    return plan;
  } catch (cause) {
    recorder.record(dryRunReport(named, { problem: messageWithoutPaths(cause) }));
    throw cause;
  }
}
