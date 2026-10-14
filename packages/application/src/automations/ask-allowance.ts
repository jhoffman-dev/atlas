import {
  asksSpentInHour,
  automationIdKey,
  sharesAskAllowance,
  type AutomationRule,
  type LocalTime,
  type LogEntry,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { readRuleLog } from './automation-log.ts';
import { loadAutomations } from './load-automations.ts';

interface AllowancePorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
}

/**
 * The log entries the vault's one hourly ask allowance is counted over
 * (#179): for a rule whose step spends it, `own` — the rule's log as this
 * run read it — and the log of every other rule that spends it; for any
 * other rule, `own` alone.
 */
export async function allowanceEntries(
  { fs, markdown }: AllowancePorts,
  rule: AutomationRule,
  own: readonly LogEntry[],
): Promise<readonly LogEntry[]> {
  if (!sharesAskAllowance(rule.action)) return own;
  const notePaths = await listVaultNotes({ fs });
  const { automations } = await loadAutomations({ fs, markdown, notePaths });
  const others = automations.filter(
    (other) =>
      automationIdKey(other.rule.id) !== automationIdKey(rule.id) &&
      sharesAskAllowance(other.rule.action),
  );
  return [...own, ...others.flatMap((other) => other.log)];
}

/**
 * How many asks the vault's hourly allowance has had in the hour up to `now`,
 * when `rule` spends it; 0 when it does not, as its asks are bounded by its
 * per-run budget alone.
 */
export async function askedThisHour(
  ports: AllowancePorts,
  rule: AutomationRule,
  now: LocalTime,
): Promise<number> {
  if (!sharesAskAllowance(rule.action)) return 0;
  const own = await readRuleLog(ports.fs, rule);
  return asksSpentInHour(await allowanceEntries(ports, rule, own.entries), now);
}
