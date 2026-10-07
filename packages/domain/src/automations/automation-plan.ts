import { archiveRefusal } from '../archive/archive.ts';
import { isAtlasNote } from '../vault/vault-visibility.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { MAX_ACTIONS_PER_RUN } from './automation-query.ts';
import type { AutomationAction } from './automation-rule.ts';

/** A note the rule matched and will not touch, and why. */
export interface PassedOver {
  readonly path: VaultPath;
  readonly reason: string;
}

/** What a rule would do now: the dry run, and what a run carries out. */
export interface AutomationPlan {
  readonly action: AutomationAction;
  /** The notes it would act on, at most {@link MAX_ACTIONS_PER_RUN}. */
  readonly paths: readonly VaultPath[];
  /** Matched, and refused by the action's own rules. */
  readonly passedOver: readonly PassedOver[];
  /**
   * It matched more than one run may do; the rest wait for the next. The
   * query asks for one more than the cap, so how many more is not known.
   */
  readonly capped: boolean;
}

/**
 * What a rule would do to the notes its query matched (P25-01). Pure: the
 * runner is handed this and only carries it out.
 *
 * A note the action cannot apply to — Atlas's own files, a note already
 * archived — is passed over and said so. Past the cap, the rest wait.
 */
export function planAutomation({
  action,
  matched,
  cap = MAX_ACTIONS_PER_RUN,
}: {
  action: AutomationAction;
  /** The query's rows' paths, in the query's order, without repeats. */
  matched: readonly VaultPath[];
  cap?: number;
}): AutomationPlan {
  const paths: VaultPath[] = [];
  const passedOver: PassedOver[] = [];
  const seen = new Set<string>();
  for (const path of matched) {
    if (seen.has(path)) continue;
    seen.add(path);
    const refusal = refusalOf(action, path);
    if (refusal === null) paths.push(path);
    else passedOver.push({ path, reason: refusal });
  }
  return {
    action,
    paths: paths.slice(0, cap),
    passedOver,
    capped: paths.length > cap,
  };
}

function refusalOf(action: AutomationAction, path: VaultPath): string | null {
  if (action.kind === 'archive') return archiveRefusal(path);
  return isAtlasNote(path) ? 'Atlas keeps its own files as they are.' : null;
}

/** The plan in a sentence: "Would archive 12 notes." */
export function describePlan(plan: AutomationPlan): string {
  const count = plan.paths.length;
  const notes = `${count} ${count === 1 ? 'note' : 'notes'}`;
  const verb = plan.action.kind === 'archive' ? 'archive' : 'change';
  const head = count === 0 ? 'Nothing to do right now.' : `Would ${verb} ${notes}.`;
  return plan.capped ? `${head} ${cappedLine(plan.paths.length)}` : head;
}

/** What a run that reached the cap says about the rest. */
export function cappedLine(cap: number): string {
  return `Stopped at ${cap}, the most one run may do; the rest wait for the next run.`;
}
