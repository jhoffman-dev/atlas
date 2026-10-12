import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { ClaudeRunInfo } from './run-log.ts';
import type { RuleStep } from './rule-steps.ts';
import {
  claudeStepRecord,
  correctionStepRecord,
  failedStepRecord,
  linkStepRecord,
  skippedStepRecord,
  stepsFailedProblem,
  unaskedStepRecord,
} from './rule-step-words.ts';

/**
 * P29-06: the one sentence each step of a rule says it did to a note. The
 * words are tested whole, since they are what the log and Activity show.
 */

const CORRECT: RuleStep = { kind: 'correct-terms' };
const LINK: RuleStep = { kind: 'link-meeting' };
const ITEMS: RuleStep = {
  kind: 'claude',
  prompt: '.atlas/prompts/Meeting items.md',
  tools: [],
  output: { kind: 'proposals', schema: 'meeting-items' },
};
const TERMS: RuleStep = {
  kind: 'claude',
  prompt: '.atlas/prompts/Suggest terms.md',
  tools: [],
  output: { kind: 'proposals', schema: 'term-suggestions' },
};
const NOTE: RuleStep = {
  kind: 'claude',
  prompt: '.atlas/prompts/Digest.md',
  tools: [],
  output: { kind: 'note', folder: 'Digests' },
};
const RAN: ClaudeRunInfo = { model: 'test-model', ms: 10, asks: 1 };

describe('what correcting a meeting’s terms says', () => {
  it('says how many spellings it put right, one or many', () => {
    expect(correctionStepRecord(CORRECT, { kind: 'corrected', count: 1 })).toEqual({
      step: 'correct-terms',
      outcome: 'done',
      said: 'Corrected 1 misheard spelling.',
    });
    expect(correctionStepRecord(CORRECT, { kind: 'corrected', count: 3 }).said).toBe(
      'Corrected 3 misheard spellings.',
    );
  });

  it('says it was already corrected when it arrived, and not corrected again', () => {
    expect(correctionStepRecord(CORRECT, { kind: 'already', count: 2 })).toEqual({
      step: 'correct-terms',
      outcome: 'already',
      said: 'Already corrected when it arrived (2 misheard spellings); not corrected again.',
    });
    expect(correctionStepRecord(CORRECT, { kind: 'already', count: 1 }).said).toContain(
      '(1 misheard spelling)',
    );
  });

  it('says its corrections were undone and its words left as they are', () => {
    expect(correctionStepRecord(CORRECT, { kind: 'undone' })).toEqual({
      step: 'correct-terms',
      outcome: 'already',
      said: 'Its corrections were undone, so its words were left as they are.',
    });
  });

  it('says there was no misheard spelling to correct', () => {
    expect(correctionStepRecord(CORRECT, { kind: 'none' })).toEqual({
      step: 'correct-terms',
      outcome: 'nothing',
      said: 'No misheard spelling to correct.',
    });
  });
});

describe('what linking a meeting says', () => {
  const mara = createVaultPath('People/Mara Quill.md');
  const tobias = createVaultPath('People/Tobias Fenn.md');

  it('names the notes it linked', () => {
    expect(
      linkStepRecord(LINK, { kind: 'linked', linked: [mara, tobias], proposed: 0, left: [] }),
    ).toEqual({
      step: 'link-meeting',
      outcome: 'done',
      said: 'Linked Mara Quill, Tobias Fenn.',
    });
  });

  it('adds what it proposed in the Inbox', () => {
    expect(
      linkStepRecord(LINK, { kind: 'linked', linked: [mara], proposed: 2, left: [] }).said,
    ).toBe('Linked Mara Quill; proposed 2 in the Inbox.');
  });

  it('is done when it only proposed', () => {
    expect(linkStepRecord(LINK, { kind: 'linked', linked: [], proposed: 1, left: [] })).toEqual({
      step: 'link-meeting',
      outcome: 'done',
      said: 'Linked no one new; proposed 1 in the Inbox.',
    });
  });

  it('says what it could not write, each reason without its closing full stop', () => {
    const said = linkStepRecord(LINK, {
      kind: 'linked',
      linked: [mara],
      proposed: 0,
      left: ['Lena Hart has two notes.', 'no company note'],
    }).said;

    expect(said).toBe('Linked Mara Quill; left: Lena Hart has two notes; left: no company note.');
  });

  it('is nothing when it linked no one and proposed nothing', () => {
    expect(linkStepRecord(LINK, { kind: 'linked', linked: [], proposed: 0, left: [] })).toEqual({
      step: 'link-meeting',
      outcome: 'nothing',
      said: 'Linked no one new.',
    });
    expect(
      linkStepRecord(LINK, { kind: 'linked', linked: [], proposed: 0, left: ['nobody matched'] }),
    ).toMatchObject({ outcome: 'nothing', said: 'Linked no one new; left: nobody matched.' });
  });

  it('says it was already linked when it arrived, and not linked again', () => {
    expect(linkStepRecord(LINK, { kind: 'already', undone: false })).toEqual({
      step: 'link-meeting',
      outcome: 'already',
      said: 'Already linked when it arrived; not linked again.',
    });
  });

  it('says its links were undone, so it was not linked again', () => {
    expect(linkStepRecord(LINK, { kind: 'already', undone: true })).toEqual({
      step: 'link-meeting',
      outcome: 'already',
      said: 'Its links were undone, so it was not linked again.',
    });
  });
});

describe('what a Claude step says', () => {
  it('names the step by what it writes', () => {
    expect(claudeStepRecord(ITEMS, { made: 1, claude: RAN }).step).toBe('claude meeting-items');
    expect(claudeStepRecord(TERMS, { made: 1, claude: RAN }).step).toBe('claude term-suggestions');
    expect(claudeStepRecord(NOTE, { made: 1, claude: RAN }).step).toBe('claude note');
  });

  it.each([
    [ITEMS, 1, 'made 1 proposal', 'proposed nothing'],
    [ITEMS, 4, 'made 4 proposals', 'proposed nothing'],
    [TERMS, 1, 'suggested 1 term', 'suggested no terms'],
    [TERMS, 2, 'suggested 2 terms', 'suggested no terms'],
    [NOTE, 1, 'made its note', 'made no note'],
  ])('says what %# made, and what it made when nothing came of it', (step, made, did, none) => {
    const done = claudeStepRecord(step, { made, claude: RAN });
    const nothing = claudeStepRecord(step, { made: 0, claude: RAN });

    expect(done).toMatchObject({ outcome: 'done', said: `Asked Claude 1 time: ${did}.` });
    expect(nothing).toMatchObject({ outcome: 'nothing', said: `Asked Claude 1 time: ${none}.` });
  });

  it('says how often it asked, once or many', () => {
    expect(claudeStepRecord(ITEMS, { made: 1, claude: { ...RAN, asks: 2 } }).said).toMatch(
      /^Asked Claude 2 times:/,
    );
  });

  it('says it did not ask Claude when it was never asked', () => {
    const neverAsked: ClaudeRunInfo = { model: RAN.model, ms: RAN.ms };

    expect(claudeStepRecord(ITEMS, { made: 0, claude: neverAsked })).toEqual({
      step: 'claude meeting-items',
      outcome: 'nothing',
      said: 'Did not ask Claude: proposed nothing.',
    });
    expect(claudeStepRecord(ITEMS, { made: 0, claude: { ...RAN, asks: 0 } }).said).toMatch(
      /^Did not ask Claude:/,
    );
  });

  it('says nothing new when everything it answered with was made before', () => {
    const record = claudeStepRecord(ITEMS, { made: 0, claude: { ...RAN, alreadyMade: 3 } });

    expect(record).toEqual({
      step: 'claude meeting-items',
      outcome: 'nothing',
      said: 'Asked Claude 1 time: nothing new (3 already made).',
    });
  });

  it('adds how many were already made beside what it made now', () => {
    const record = claudeStepRecord(ITEMS, { made: 2, claude: { ...RAN, alreadyMade: 1 } });

    expect(record.said).toBe('Asked Claude 1 time: made 2 proposals (1 already made).');
  });

  it('counts what it left out, put right, and read in part, in that order', () => {
    const item = { title: 'x', reason: 'y' };
    const record = claudeStepRecord(TERMS, {
      made: 1,
      claude: {
        ...RAN,
        alreadyMade: 2,
        dropped: [item, item],
        adjusted: [item],
        cut: [{ path: createVaultPath('Inbox/Meetings/Long.md'), shown: 10, of: 100 }],
      },
    });

    expect(record.said).toBe(
      'Asked Claude 1 time: suggested 1 term (2 already made, 2 left out, 1 put right, read in part).',
    );
  });

  it('says nothing of an empty list of dropped, adjusted or cut', () => {
    const record = claudeStepRecord(ITEMS, {
      made: 1,
      claude: { ...RAN, dropped: [], adjusted: [], cut: [] },
    });

    expect(record.said).toBe('Asked Claude 1 time: made 1 proposal.');
  });

  it('still says what it left out when it made nothing', () => {
    const record = claudeStepRecord(TERMS, {
      made: 0,
      claude: { ...RAN, dropped: [{ title: 'mark → Marq', reason: 'everyday' }] },
    });

    expect(record.said).toBe('Asked Claude 1 time: suggested no terms (1 left out).');
  });
});

describe('what a step that did not go says', () => {
  it('says which step failed and why, on one line', () => {
    expect(failedStepRecord(CORRECT, 'The vault\n  was   locked.  ')).toEqual({
      step: 'correct-terms',
      outcome: 'failed',
      said: 'Correct its terms failed: The vault was locked.',
    });
    expect(failedStepRecord(LINK, 'no').said).toBe('Link its people and companies failed: no');
    expect(failedStepRecord(ITEMS, 'timed out')).toMatchObject({
      step: 'claude meeting-items',
      said: 'Ask Claude (Meeting items) for meeting-items failed: timed out',
    });
  });

  it('says a step was not run because an earlier one failed', () => {
    expect(skippedStepRecord(LINK)).toEqual({
      step: 'link-meeting',
      outcome: 'skipped',
      said: 'Link its people and companies: not run, because an earlier step failed.',
    });
  });

  it('says a Claude step was not run because the run had no questions left', () => {
    expect(unaskedStepRecord(NOTE)).toEqual({
      step: 'claude note',
      outcome: 'skipped',
      said: 'Ask Claude (Digest) for a note in Digests: not run, because this run had no questions left to put to Claude. Run it by hand.',
    });
  });

  it('says which step of how many stopped a run, with what it said', () => {
    const record = failedStepRecord(LINK, 'disk full');

    expect(stepsFailedProblem({ at: 2, of: 3, record })).toBe(
      'Step 2 of 3 stopped it. Link its people and companies failed: disk full What the steps before it did stays.',
    );
  });
});
