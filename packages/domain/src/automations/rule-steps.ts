/**
 * A rule that does several things in order (P29-06, ADR-0028): its file says
 * `do: steps` and lists them under `steps:`, each as a rule of its own would
 * write its action.
 *
 * ```yaml
 * do: steps
 * steps:
 *   - do: correct-terms
 *   - do: link-meeting
 *   - do: claude
 *     prompt: .atlas/prompts/meeting-extraction.md
 *     output: meeting-items
 * ```
 *
 * A rule with one action is written as it always was; nothing here reads it.
 * The steps run on each note in turn, in the order written. One that fails
 * stops the steps after it for that note, and what the earlier ones did stays.
 *
 * What may be a step is a short list: the two declared deterministic steps of
 * a meeting (its terms corrected, its people and companies linked — each
 * recorded on the meeting and undoable there) and a Claude step, which only
 * proposes. Archiving and setting a property stay rules of their own: a step
 * that moved the note would take it from under the steps after it.
 */

import { isRecord } from '../query/frontmatter-query.ts';
import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import {
  claudeActionFields,
  describeClaudeAction,
  readClaudeAction,
  type ClaudeAction,
} from './claude-step.ts';
import type { Schedule } from './schedule.ts';

/** What a rule's `do:` says when it lists steps. */
export const STEPS_ACTION = 'steps';

/** The step that puts a meeting's misheard spellings right (P28-06). */
export const CORRECT_TERMS_STEP = 'correct-terms';

/** The step that links a meeting to its people and companies, and proposes the rest (P29-04). */
export const LINK_MEETING_STEP = 'link-meeting';

/** The most steps one rule lists: a pipeline, not a program. */
export const MAX_RULE_STEPS = 6;

/** One step of a rule. */
export type RuleStep =
  | { readonly kind: typeof CORRECT_TERMS_STEP }
  | { readonly kind: typeof LINK_MEETING_STEP }
  | ClaudeAction;

/** A rule's action when it is a list of steps. */
export interface StepsAction {
  readonly kind: typeof STEPS_ACTION;
  readonly steps: readonly RuleStep[];
}

const STEP_WORDS = `${CORRECT_TERMS_STEP}, ${LINK_MEETING_STEP} or claude`;

/** The steps a rule's frontmatter lists, or why they cannot be run. */
export function readStepsAction(
  frontmatter: Readonly<Record<string, unknown>>,
): StepsAction | string {
  const written = frontmatter['steps'];
  if (!Array.isArray(written) || written.length === 0) {
    return `A rule with steps lists them under steps:, each with its own do: ${STEP_WORDS}.`;
  }
  if (written.length > MAX_RULE_STEPS) {
    return `A rule lists at most ${MAX_RULE_STEPS} steps; this one has ${written.length}.`;
  }
  const steps: RuleStep[] = [];
  for (const [at, each] of written.entries()) {
    const step = readStep(each);
    if (typeof step === 'string') return `Step ${at + 1}: ${step}`;
    steps.push(step);
  }
  return { kind: STEPS_ACTION, steps };
}

function readStep(value: unknown): RuleStep | string {
  if (!isRecord(value)) return `Write it as its own do: ${STEP_WORDS}.`;
  const word = String(value['do'] ?? '')
    .trim()
    .toLowerCase();
  if (word === CORRECT_TERMS_STEP || word === LINK_MEETING_STEP) return { kind: word };
  if (word === 'claude') return readClaudeAction(value);
  if (word === 'archive' || word === 'set') {
    return `A step cannot ${word === 'set' ? 'set a property' : 'archive'}: that stays a rule of its own. A step is ${STEP_WORDS}.`;
  }
  return `Say what it does: do: ${STEP_WORDS}.`;
}

/** Whether a step acts on a meeting and nothing else. */
const isMeetingStep = (step: RuleStep): boolean =>
  step.kind === CORRECT_TERMS_STEP || step.kind === LINK_MEETING_STEP;

/**
 * Why a rule with these steps cannot run on this trigger, or null when it
 * can. Correcting and linking are steps of a meeting: a rule that holds
 * either must be one a meeting sets off, so it is never handed another note.
 */
export function stepsTriggerProblem(action: StepsAction, when: Schedule): string | null {
  if (!action.steps.some(isMeetingStep)) return null;
  const onMeetings = when.kind === 'note' && when.type.trim().toLowerCase() === MEETING_TYPE;
  return onMeetings
    ? null
    : `The steps ${CORRECT_TERMS_STEP} and ${LINK_MEETING_STEP} act on a meeting: write when: a meeting is created.`;
}

/** The steps as the rule's file writes them; null for a rule without, which takes the key out. */
export function stepsField(action: StepsAction | null): Record<string, unknown> {
  if (action === null) return { steps: null };
  return {
    steps: action.steps.map((step) =>
      step.kind === 'claude'
        ? { do: step.kind, ...withoutEmpty(claudeActionFields(step)) }
        : { do: step.kind },
    ),
  };
}

/** A step's own keys with nothing written for those it does not use: a list item has no key to take out. */
function withoutEmpty(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
}

/**
 * What a step is called in the rule's log, and anywhere a program reads it:
 * its kind, and for a Claude step what it writes — `claude meeting-items`.
 */
export function stepName(step: RuleStep): string {
  if (step.kind !== 'claude') return step.kind;
  return `claude ${step.output.kind === 'note' ? 'note' : step.output.schema}`;
}

/** A step in a few words, for a person: "Correct its terms". */
export function describeStep(step: RuleStep): string {
  if (step.kind === CORRECT_TERMS_STEP) return 'Correct its terms';
  if (step.kind === LINK_MEETING_STEP) return 'Link its people and companies';
  return describeClaudeAction(step);
}

/** The steps in a line, in order: "Correct its terms → Link its people and companies → …". */
export function describeSteps(action: StepsAction): string {
  return action.steps.map(describeStep).join(' → ');
}
