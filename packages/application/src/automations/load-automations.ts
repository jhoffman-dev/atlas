import {
  automationIdKey,
  createVaultPath,
  isAutomationNote,
  isAutomationPath,
  parseAutomationRule,
  splitFrontmatter,
  type AutomationRule,
  type BrokenAutomation,
  type LogEntry,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { readRuleLog } from './automation-log.ts';

/** A rule and what its log says, as the Automations page lists it. */
export interface LoadedAutomation {
  readonly rule: AutomationRule;
  readonly log: readonly LogEntry[];
  /** Whether its file says its id; a rule from before ids has one written for it. */
  readonly idWritten: boolean;
}

export interface AutomationListing {
  readonly automations: readonly LoadedAutomation[];
  /** Rule files that could not be read: listed with why, never run. */
  readonly broken: readonly BrokenAutomation[];
}

/**
 * Every automation in the vault, with its log, sorted by name. A file in the
 * automations folder that does not say `atlas: automation` is not a rule and
 * is left out; one that says so and cannot be read is listed as broken.
 */
export async function loadAutomations({
  fs,
  markdown,
  notePaths,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  notePaths: readonly string[];
}): Promise<AutomationListing> {
  const files = await fs.readNotes(notePaths.filter(isAutomationPath).sort());
  const automations: LoadedAutomation[] = [];
  const broken: BrokenAutomation[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const frontmatter = markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
    if (!isAutomationNote(frontmatter)) continue;
    const read = parseAutomationRule(createVaultPath(file.path), frontmatter);
    if ('broken' in read) {
      broken.push(read.broken);
      continue;
    }
    const { rule, idWritten } = read;
    // A copied rule file shares its id: two rules writing one log would undo each other's runs.
    const id = automationIdKey(rule.id);
    if (ids.has(id)) {
      const problem = `Another automation has id: ${rule.id}. Give this one its own id.`;
      broken.push({ path: rule.path, name: rule.name, problem });
      continue;
    }
    ids.add(id);
    const log = await readRuleLog(fs, rule);
    automations.push({ rule, log: log.entries, idWritten });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    automations: automations.sort((a, b) => byName(a.rule, b.rule)),
    broken: broken.sort(byName),
  };
}
