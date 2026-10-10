import {
  automationQuery,
  checkAtlasQuery,
  createVaultPath,
  MAX_ACTIONS_PER_RUN,
  parseAtlasQuery,
  planAutomation,
  printAtlasQuery,
  problemOf,
  QueryTextError,
  splitFrontmatter,
  wouldChange,
  type AutomationAction,
  type AutomationPlan,
  type AutomationRule,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { AtlasQueryError, runAtlasQuery } from '../query/run-atlas-query.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What finding a rule's notes needs: the index to ask, the vault's types and notes, and the notes themselves. */
export interface RuleQueryPorts {
  readonly index: IndexPort;
  readonly types: readonly ObjectType[];
  readonly notePaths: readonly string[];
  readonly fs: Pick<VaultFsPort, 'readNotes'>;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
}

/** How many matched notes are read at once, while looking for the ones a set rule would change. */
const READ_BATCH = 200;

/**
 * What a rule would do today (P25-02): its query, with its moving dates and
 * age filter pinned to `today`, asked of the index, and the notes found
 * planned by the domain. Nothing is written. Rejects with `AtlasQueryError`
 * when the query does not read — checked as the query page checks it, before
 * its dates are pinned, so `status = @today` is refused here as it is there.
 *
 * Notes the rule would leave as they are — a set rule's notes that already
 * hold its values — are left out before the cap is counted, so they cannot
 * take the places of the notes still to do (A25-01).
 */
export async function planRun(args: PlanArgs): Promise<AutomationPlan> {
  const matched = await matchedPaths(args);
  return planMatched({ ports: args.ports, action: args.rule.action, matched });
}

interface PlanArgs {
  readonly ports: RuleQueryPorts;
  readonly rule: Pick<AutomationRule, 'which' | 'olderThanDays' | 'action'>;
  /** `YYYY-MM-DD`, from the injected clock. */
  readonly today: string;
  /** Only these notes, for a rule notes set off (P29-01); left out for every note it matches. */
  readonly among?: readonly VaultPath[];
}

/** The paths the rule's query matches today, in its order. Rejects as {@link planRun} does. */
export async function matchedPaths({ ports, rule, today, among }: PlanArgs): Promise<VaultPath[]> {
  const text = pinnedText({
    rule,
    today,
    types: ports.types,
    ...(among !== undefined && { among }),
  });
  const answer = await runAtlasQuery({ ...ports, text });
  const column = answer.result.columns.indexOf('path');
  return answer.result.rows.flatMap((row): VaultPath[] => {
    const path = row[column];
    return typeof path === 'string' ? [createVaultPath(path)] : [];
  });
}

/** What the action would do to the notes matched: those it would change, planned by the domain. */
export async function planMatched({
  ports,
  action,
  matched,
}: {
  ports: RuleQueryPorts;
  action: AutomationAction;
  matched: readonly VaultPath[];
}): Promise<AutomationPlan> {
  const changing = await toChange({ ports, action, matched });
  return planAutomation({ action, matched: changing });
}

/** The matched notes the action would change, read in batches until there are more than a run may do. */
async function toChange({
  ports,
  action,
  matched,
}: {
  ports: RuleQueryPorts;
  action: AutomationAction;
  matched: readonly VaultPath[];
}): Promise<VaultPath[]> {
  if (action.kind === 'archive') return [...matched];
  const changing: VaultPath[] = [];
  for (let start = 0; start < matched.length && changing.length <= MAX_ACTIONS_PER_RUN;) {
    const batch = matched.slice(start, start + READ_BATCH);
    start += READ_BATCH;
    const files = new Map(
      (await ports.fs.readNotes(batch)).map((file) => [file.path, file.text] as const),
    );
    for (const path of batch) {
      const text = files.get(path);
      // A note gone since the index answered is left for the run to report.
      const properties =
        text === undefined
          ? {}
          : ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
      if (wouldChange(action, properties)) changing.push(path);
    }
  }
  return changing;
}

function pinnedText({
  rule,
  today,
  types,
  among,
}: Omit<PlanArgs, 'ports'> & { types: readonly ObjectType[] }): string {
  try {
    const query = parseAtlasQuery(rule.which);
    checkAtlasQuery(query, types);
    const { olderThanDays, action } = rule;
    return printAtlasQuery(
      automationQuery({
        query,
        today,
        olderThanDays,
        action,
        ...(among !== undefined && { among }),
      }),
    );
  } catch (cause) {
    if (cause instanceof QueryTextError) throw new AtlasQueryError(cause.message, problemOf(cause));
    throw cause;
  }
}
