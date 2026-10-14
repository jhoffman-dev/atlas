/**
 * What a rule's Claude step may spend, and which model it asks (#179).
 *
 * Every step asks at most {@link CLAUDE_ASKS_PER_RUN} times a run, and a rule
 * a note sets off spends the {@link NOTE_RUNS_PER_HOUR} runs an hour every
 * such rule has (ADR-0028). The declared step — one whose rule says
 * `apply: mine`, the "After a meeting" rule's (ADR-0036) — runs unattended on
 * every meeting, so a backlog can be many asks. It has a budget of its own:
 * at most {@link DECLARED_STEP_ASKS_PER_RUN} asks a run, a reduce ask
 * included, and an allowance of {@link DECLARED_STEP_ASKS_PER_HOUR} asks an
 * hour counted apart from the shared runs, so a backlog neither spends the
 * shared cap nor is starved by it. It asks a cheaper model,
 * {@link DECLARED_STEP_MODEL}, unless its rule names one.
 */

import type { AutomationAction } from './automation-rule.ts';
import { CLAUDE_ASKS_PER_RUN } from './answered-note.ts';
import type { ClaudeAction } from './claude-step.ts';

/** The most asks the declared step makes in one run, the reduce ask included. */
export const DECLARED_STEP_ASKS_PER_RUN = 10;

/** The asks the declared step may make in an hour, apart from the shared runs. */
export const DECLARED_STEP_ASKS_PER_HOUR = 30;

/** The model the declared step asks when its rule names none: Sonnet, the cheaper one. */
export const DECLARED_STEP_MODEL = 'claude-sonnet-5-5';

export interface ClaudeStepBudget {
  /** The most asks one run makes. */
  readonly asksPerRun: number;
  /**
   * The asks an hour it may make, counted apart from the shared runs; null
   * when its asks spend the shared runs, as every other step's do.
   */
  readonly asksPerHour: number | null;
}

/** What every rule's step may spend: its asks count against the shared runs an hour. */
export const SHARED_STEP_BUDGET: ClaudeStepBudget = {
  asksPerRun: CLAUDE_ASKS_PER_RUN,
  asksPerHour: null,
};

const DECLARED_STEP_BUDGET: ClaudeStepBudget = {
  asksPerRun: DECLARED_STEP_ASKS_PER_RUN,
  asksPerHour: DECLARED_STEP_ASKS_PER_HOUR,
};

function isDeclaredStep(action: AutomationAction): boolean {
  return action.kind === 'claude' && action.apply === 'mine';
}

/** What a rule doing `action` may spend: the declared step's own, or the shared budget. */
export function claudeStepBudget(action: AutomationAction): ClaudeStepBudget {
  return isDeclaredStep(action) ? DECLARED_STEP_BUDGET : SHARED_STEP_BUDGET;
}

/**
 * The model a step asks: the one its rule names; else Sonnet for the
 * declared step; else the chat's, as chosen in Settings → Claude.
 */
export function claudeStepModel(action: ClaudeAction, chatModel: string): string {
  return action.model ?? claudeStepDefaultModel(action) ?? chatModel;
}

/** The model a step asks when its rule names none: Sonnet for the declared step; null, the chat's. */
export function claudeStepDefaultModel(action: ClaudeAction): string | null {
  return isDeclaredStep(action) ? DECLARED_STEP_MODEL : null;
}

/** Why a run that has asked `asked` times may not ask again, or null while it may. */
export function claudeAskRefusal(budget: ClaudeStepBudget, asked: number): string | null {
  if (asked < budget.asksPerRun) return null;
  return `It would ask Claude more than ${budget.asksPerRun} times; one run asks at most ${budget.asksPerRun}.`;
}
