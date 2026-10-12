import { archiveRefusal } from '../archive/archive.ts';
import { isProposalPath } from '../proposals/proposal.ts';
import { isAtlasNote } from '../vault/vault-visibility.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { MAX_ACTIONS_PER_RUN } from './automation-query.ts';
import { remembersNotes, type AutomationAction } from './automation-rule.ts';
import { CLAUDE_NOTES_PER_RUN } from './claude-step.ts';
import { describeSteps, STEPS_ACTION } from './rule-steps.ts';

/** A note the rule matched and will not touch, and why. */
export interface PassedOver {
  readonly path: VaultPath;
  readonly reason: string;
}

/** What a rule would do now: the dry run, and what a run carries out. */
export interface AutomationPlan {
  readonly action: AutomationAction;
  /** The notes it would act on, at most {@link capFor} the action. */
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
  cap = capFor(action),
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

/**
 * The most notes one run of the action takes: a Claude step reads each one,
 * which costs a model's time, so it takes far fewer than a move does — and a
 * rule of several steps does each of them to every note.
 */
export function capFor(action: AutomationAction): number {
  return remembersNotes(action) ? CLAUDE_NOTES_PER_RUN : MAX_ACTIONS_PER_RUN;
}

function refusalOf(action: AutomationAction, path: VaultPath): string | null {
  if (action.kind === 'archive') return archiveRefusal(path);
  // Read, a proposal would be answered with more proposals, each setting the rule off again.
  if (remembersNotes(action) && isProposalPath(path)) {
    return 'A Claude step does not read proposals: it would be answering itself.';
  }
  return isAtlasNote(path) ? 'Atlas keeps its own files as they are.' : null;
}

/** The plan in a sentence: "Would archive 12 notes." */
export function describePlan(plan: AutomationPlan): string {
  const count = plan.paths.length;
  const notes = `${count} ${count === 1 ? 'note' : 'notes'}`;
  const head =
    count === 0 ? 'Nothing to do right now.' : `Would ${planVerb(plan.action)} ${notes}.`;
  const steps = plan.action.kind === STEPS_ACTION ? ` ${stepsLine(plan.action)}` : '';
  return plan.capped ? `${head}${steps} ${cappedLine(plan.paths.length)}` : `${head}${steps}`;
}

/** What a dry run says a rule of several steps would do to each note, in order. */
function stepsLine(action: Extract<AutomationAction, { kind: typeof STEPS_ACTION }>): string {
  return `For each, in order: ${describeSteps(action)}. A step that fails stops the ones after it.`;
}

/** What a plan would do to its notes, as "Would … 12 notes" says it. */
export function planVerb(action: AutomationAction): string {
  if (action.kind === 'archive') return 'archive';
  if (action.kind === STEPS_ACTION) return `run its ${action.steps.length} steps on`;
  return action.kind === 'set' ? 'change' : 'ask Claude about';
}

/** What a run that reached the cap says about the rest. */
export function cappedLine(cap: number): string {
  return `Stopped at ${cap}, the most one run may do; the rest wait for the next run.`;
}
