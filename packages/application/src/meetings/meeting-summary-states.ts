import {
  addDays,
  createVaultPath,
  lastRunOf,
  meetingSummaryState,
  splitFrontmatter,
  SUMMARY_PENDING_DAYS,
  writesSummaries,
  type MeetingSummaryState,
  type VaultPath,
} from '@dfai/domain';
import { loadAutomations, type LoadedAutomation } from '../automations/load-automations.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** Where each meeting's summary stands, and why the pending ones wait. */
export interface MeetingSummaryStates {
  readonly states: ReadonlyMap<VaultPath, MeetingSummaryState>;
  /**
   * Why a pending summary waits, in words the person can act on: the last
   * run of the rule that writes them, when it failed (the fix-it line it
   * logged), else that it has not run on the meeting yet.
   */
  readonly pendingWhy: string;
}

/**
 * Reads where each of `paths`' summaries stands (#186): the meeting files as
 * they are, and the vault's rules and their logs for whether a summary is
 * still coming — a rule that writes them is on, and has not answered the
 * meeting yet. Reads only; writes nothing.
 */
export async function readMeetingSummaryStates({
  fs,
  markdown,
  notePaths,
  paths,
  today,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  /** Every note in the vault: where the rules are found. */
  notePaths: readonly string[];
  /** The meetings to say it of. */
  paths: readonly VaultPath[];
  /** `YYYY-MM-DD`: how far back the rule reaches is counted from it. */
  today: string;
}): Promise<MeetingSummaryStates> {
  if (paths.length === 0) return { states: new Map(), pendingWhy: '' };
  const { automations } = await loadAutomations({ fs, markdown, notePaths });
  const summarising = automations.filter(({ rule }) => writesSummaries(rule));
  const answered = answeredPaths(summarising);
  const from = addDays(today, -SUMMARY_PENDING_DAYS) ?? today;
  const files = await fs.readNotes(paths);
  const states = new Map<VaultPath, MeetingSummaryState>();
  for (const file of files) {
    const path = createVaultPath(file.path);
    const { frontmatter, body } = splitFrontmatter(file.text);
    const state = meetingSummaryState({
      path,
      body,
      properties: markdown.frontmatterProperties(frontmatter),
      step: { summarising: summarising.length > 0, from, answered: answered.has(path) },
    });
    states.set(path, state);
  }
  return { states, pendingWhy: pendingWhyOf(summarising) };
}

/** The meetings the rules that write summaries have answered: their ledgers, and the runs their logs still hold. */
function answeredPaths(rules: readonly LoadedAutomation[]): Set<string> {
  const paths = new Set<string>();
  for (const { ledger, log } of rules) {
    for (const path of ledger?.paths.keys() ?? []) paths.add(path);
    for (const { path } of ledger?.answered ?? []) paths.add(path);
    for (const entry of log) {
      if (entry.kind !== 'run') continue;
      for (const version of entry.versions ?? []) paths.add(version.path);
    }
  }
  return paths;
}

/** Why a summary waits: a rule's failed last run, said as it logged it; else that the rule has yet to run on it. */
function pendingWhyOf(rules: readonly LoadedAutomation[]): string {
  for (const { log } of rules) {
    const last = lastRunOf(log);
    if (last?.kind === 'failed') return last.problem;
  }
  const [first] = rules;
  return first === undefined ? '' : `waiting for “${first.rule.name}” to run`;
}
