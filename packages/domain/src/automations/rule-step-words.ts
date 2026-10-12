/**
 * What each step of a rule of several says it did to one note (P29-06): one
 * sentence a step, kept in the rule's log and shown under the run's line in
 * Activity. The words are decided here so the log, Activity and the API say
 * the same thing, and so "already done" is said as exactly that: a meeting
 * the import corrected and linked is not corrected or linked again, and the
 * log does not claim it was.
 */

import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { describeStep, stepName, type RuleStep } from './rule-steps.ts';
import type { ClaudeRunInfo, StepRecord } from './run-log.ts';
import { TERM_SUGGESTIONS_OUTPUT } from './term-suggestions.ts';

const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const spellings = (count: number): string =>
  counted(count, 'misheard spelling', 'misheard spellings');

/** What correcting a meeting's terms came to. */
export type CorrectionOutcome =
  /** This step put `count` spellings right. */
  | { readonly kind: 'corrected'; readonly count: number }
  /** They were put right before the step ran — by the import, as the meeting was let in. */
  | { readonly kind: 'already'; readonly count: number }
  /** Its corrections were undone, and are never made again by themselves. */
  | { readonly kind: 'undone' }
  /** Read, and nothing in it is a misheard spelling the vocabulary lists. */
  | { readonly kind: 'none' };

export function correctionStepRecord(step: RuleStep, outcome: CorrectionOutcome): StepRecord {
  const name = stepName(step);
  switch (outcome.kind) {
    case 'corrected':
      return { step: name, outcome: 'done', said: `Corrected ${spellings(outcome.count)}.` };
    case 'already':
      return {
        step: name,
        outcome: 'already',
        said: `Already corrected when it arrived (${spellings(outcome.count)}); not corrected again.`,
      };
    case 'undone':
      return {
        step: name,
        outcome: 'already',
        said: 'Its corrections were undone, so its words were left as they are.',
      };
    case 'none':
      return { step: name, outcome: 'nothing', said: 'No misheard spelling to correct.' };
  }
}

/** What linking a meeting came to. */
export type LinkOutcome =
  /** This step linked these notes and wrote this many proposals. */
  | {
      readonly kind: 'linked';
      readonly linked: readonly VaultPath[];
      readonly proposed: number;
      /** What it could not write, each in a few words. */
      readonly left: readonly string[];
    }
  /** It was linked before the step ran — by the import — or its links were undone. */
  | { readonly kind: 'already'; readonly undone: boolean };

export function linkStepRecord(step: RuleStep, outcome: LinkOutcome): StepRecord {
  const name = stepName(step);
  if (outcome.kind === 'already') {
    return {
      step: name,
      outcome: 'already',
      said: outcome.undone
        ? 'Its links were undone, so it was not linked again.'
        : 'Already linked when it arrived; not linked again.',
    };
  }
  const { linked, proposed, left } = outcome;
  const parts = [
    linked.length > 0 ? `Linked ${linked.map(noteTitle).join(', ')}` : 'Linked no one new',
    ...(proposed > 0 ? [`proposed ${proposed} in the Inbox`] : []),
    ...left.map((reason) => `left: ${reason.replace(/\.$/, '')}`),
  ];
  const did = linked.length > 0 || proposed > 0;
  return { step: name, outcome: did ? 'done' : 'nothing', said: `${parts.join('; ')}.` };
}

/** What a Claude step is called when what it did is said: what it was asked for. */
function asking(step: Extract<RuleStep, { kind: 'claude' }>): {
  readonly made: (count: number) => string;
  readonly none: string;
} {
  const suggests = step.output.kind === 'proposals' && step.output.schema === TERM_SUGGESTIONS_OUTPUT;
  if (suggests) {
    return {
      made: (count) => `suggested ${counted(count, 'term', 'terms')}`,
      none: 'suggested no terms',
    };
  }
  if (step.output.kind === 'note') return { made: () => 'made its note', none: 'made no note' };
  return {
    made: (count) => `made ${counted(count, 'proposal', 'proposals')}`,
    none: 'proposed nothing',
  };
}

/** A Claude step that ran: how often it asked, what it made, and what it left out or put right. */
export function claudeStepRecord(
  step: Extract<RuleStep, { kind: 'claude' }>,
  { made, claude }: { made: number; claude: ClaudeRunInfo },
): StepRecord {
  const words = asking(step);
  const asks = claude.asks ?? 0;
  const already = claude.alreadyMade ?? 0;
  const what =
    made > 0
      ? words.made(made)
      : already > 0
        ? `nothing new (${already} already made)`
        : words.none;
  const extras = [
    ...(made > 0 && already > 0 ? [`${already} already made`] : []),
    ...((claude.dropped ?? []).length > 0 ? [`${claude.dropped!.length} left out`] : []),
    ...((claude.adjusted ?? []).length > 0 ? [`${claude.adjusted!.length} put right`] : []),
    ...((claude.cut ?? []).length > 0 ? ['read in part'] : []),
  ];
  const asked =
    asks === 0 ? 'Did not ask Claude' : `Asked Claude ${counted(asks, 'time', 'times')}`;
  const detail = extras.length === 0 ? '' : ` (${extras.join(', ')})`;
  return {
    step: stepName(step),
    outcome: made > 0 ? 'done' : 'nothing',
    said: `${asked}: ${what}${detail}.`,
  };
}

/** A step that failed: which, and why — what stops the steps after it. */
export function failedStepRecord(step: RuleStep, problem: string): StepRecord {
  return {
    step: stepName(step),
    outcome: 'failed',
    said: `${describeStep(step)} failed: ${problem.replace(/\s+/g, ' ').trim()}`,
  };
}

/** A step not run because one before it failed. */
export function skippedStepRecord(step: RuleStep): StepRecord {
  return {
    step: stepName(step),
    outcome: 'skipped',
    said: `${describeStep(step)}: not run, because an earlier step failed.`,
  };
}

/** A Claude step not run because the run had spent its questions. */
export function unaskedStepRecord(step: RuleStep): StepRecord {
  return {
    step: stepName(step),
    outcome: 'skipped',
    said: `${describeStep(step)}: not run, because this run had no questions left to put to Claude. Run it by hand.`,
  };
}

/** What a run of several steps that stopped says as its problem: which step, of how many, and why. */
export function stepsFailedProblem({
  at,
  of,
  record,
}: {
  /** The failed step's place, from 1. */
  at: number;
  of: number;
  record: StepRecord;
}): string {
  return `Step ${at} of ${of} stopped it. ${record.said} What the steps before it did stays.`;
}
