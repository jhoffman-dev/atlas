import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { capFor, describePlan, planAutomation, planVerb } from './automation-plan.ts';
import {
  automationFrontmatter,
  claudeStepsOf,
  describeAction,
  draftProblem,
  parseAutomationRule,
  remembersNotes,
  wouldChange,
  type AutomationAction,
  type AutomationDraft,
} from './automation-rule.ts';
import { MEETING_EXTRACTION_PROMPT, TERM_SUGGESTIONS_PROMPT } from './built-in-prompts.ts';
import { CLAUDE_NOTES_PER_RUN } from './claude-step.ts';
import { AFTER_A_MEETING, AFTER_A_MEETING_PRESET, AUTOMATION_PRESETS } from './presets.ts';
import {
  describeStep,
  describeSteps,
  MAX_RULE_STEPS,
  stepName,
  type StepsAction,
} from './rule-steps.ts';

const PATH = createVaultPath('.atlas/automations/After a meeting.md');

/** The "After a meeting" rule as its file writes it. */
const FILE = {
  atlas: 'automation',
  name: 'After a meeting',
  enabled: true,
  when: 'a meeting is created',
  which: 'FROM meeting',
  do: 'steps',
  steps: [
    { do: 'correct-terms' },
    { do: 'link-meeting' },
    { do: 'claude', prompt: '.atlas/prompts/meeting-extraction.md', output: 'meeting-items' },
    {
      do: 'claude',
      prompt: '.atlas/prompts/term-suggestions.md',
      tools: ['atlas_search'],
      output: 'term-suggestions',
    },
  ],
};

const actionOf = (frontmatter: Record<string, unknown>): AutomationAction | null => {
  const read = parseAutomationRule(PATH, frontmatter);
  return 'rule' in read ? read.rule.action : null;
};
const problemOf = (frontmatter: Record<string, unknown>): string | null => {
  const read = parseAutomationRule(PATH, frontmatter);
  return 'broken' in read ? read.broken.problem : null;
};

describe('a rule that lists steps', () => {
  it('reads each step in the order written, a Claude step with its own prompt, tools and output', () => {
    expect(actionOf(FILE)).toEqual({
      kind: 'steps',
      steps: [
        { kind: 'correct-terms' },
        { kind: 'link-meeting' },
        {
          kind: 'claude',
          prompt: '.atlas/prompts/meeting-extraction.md',
          tools: [],
          output: { kind: 'proposals', schema: 'meeting-items' },
        },
        {
          kind: 'claude',
          prompt: '.atlas/prompts/term-suggestions.md',
          tools: ['atlas_search'],
          output: { kind: 'proposals', schema: 'term-suggestions' },
        },
      ],
    });
  });

  it('reads the words of a step in any case', () => {
    const steps = [{ do: ' Correct-Terms ' }, { do: 'LINK-MEETING' }];
    expect(actionOf({ ...FILE, steps })).toEqual({
      kind: 'steps',
      steps: [{ kind: 'correct-terms' }, { kind: 'link-meeting' }],
    });
  });

  it('is written back as it was read: do: steps, the steps under it, and no Claude keys of its own', () => {
    const read = parseAutomationRule(PATH, FILE);
    if (!('rule' in read)) throw new Error('the rule did not read');
    const written = automationFrontmatter(read.rule);

    expect(written).toMatchObject({ do: 'steps', set: null, prompt: null, tools: null, output: null });
    expect(written['steps']).toEqual([
      { do: 'correct-terms' },
      { do: 'link-meeting' },
      {
        do: 'claude',
        prompt: '.atlas/prompts/meeting-extraction.md',
        tools: [],
        output: 'meeting-items',
      },
      {
        do: 'claude',
        prompt: '.atlas/prompts/term-suggestions.md',
        tools: ['atlas_search'],
        output: 'term-suggestions',
      },
    ]);
    expect(actionOf(written)).toEqual(read.rule.action);
  });

  it('leaves a rule of one action exactly as it was: no steps key but the one that takes it out', () => {
    const archive: AutomationDraft = AUTOMATION_PRESETS[0]!;
    const written = automationFrontmatter(archive);

    expect(written).toMatchObject({ do: 'archive', steps: null });
    expect(actionOf(written)).toEqual({ kind: 'archive' });
    // A file that never heard of steps reads as it always did.
    expect(actionOf({ ...FILE, do: 'archive', steps: undefined })).toEqual({ kind: 'archive' });
  });

  it('refuses a rule that says steps and lists none', () => {
    for (const steps of [undefined, [], 'correct-terms', { do: 'correct-terms' }]) {
      expect(problemOf({ ...FILE, steps })).toBe(
        'A rule with steps lists them under steps:, each with its own do: correct-terms, link-meeting or claude.',
      );
    }
  });

  it('refuses more steps than a rule lists', () => {
    const steps = Array.from({ length: MAX_RULE_STEPS + 1 }, () => ({ do: 'correct-terms' }));
    expect(problemOf({ ...FILE, steps })).toBe('A rule lists at most 6 steps; this one has 7.');
    expect(problemOf({ ...FILE, steps: steps.slice(0, MAX_RULE_STEPS) })).toBeNull();
  });

  it('refuses archiving and setting as steps, saying which step and why', () => {
    expect(problemOf({ ...FILE, steps: [{ do: 'correct-terms' }, { do: 'archive' }] })).toBe(
      'Step 2: A step cannot archive: that stays a rule of its own. A step is correct-terms, link-meeting or claude.',
    );
    expect(problemOf({ ...FILE, steps: [{ do: 'set', set: { status: 'done' } }] })).toBe(
      'Step 1: A step cannot set a property: that stays a rule of its own. A step is correct-terms, link-meeting or claude.',
    );
  });

  it('refuses a step that does not say what it does, or is not written as one', () => {
    expect(problemOf({ ...FILE, steps: [{ do: 'tidy' }] })).toBe(
      'Step 1: Say what it does: do: correct-terms, link-meeting or claude.',
    );
    expect(problemOf({ ...FILE, steps: ['correct-terms'] })).toBe(
      'Step 1: Write it as its own do: correct-terms, link-meeting or claude.',
    );
  });

  it('holds a Claude step to everything a Claude rule is held to, naming the step', () => {
    const steps = [{ do: 'correct-terms' }, { do: 'claude', prompt: 'notes.md', output: 'edit' }];
    expect(problemOf({ ...FILE, steps })).toMatch(
      /^Step 2: Say what Claude writes: output: one of note, proposals, .*A Claude step never edits a note/,
    );
    expect(problemOf({ ...FILE, steps: [{ do: 'claude', output: 'proposals' }] })).toBe(
      'Step 1: Name its prompt: prompt: .atlas/prompts/<name>.md.',
    );
  });

  it('refuses a meeting step in a rule a meeting does not set off', () => {
    const wanted =
      'The steps correct-terms and link-meeting act on a meeting: write when: a meeting is created.';
    expect(problemOf({ ...FILE, when: 'daily at 03:00' })).toBe(wanted);
    expect(problemOf({ ...FILE, when: 'manually' })).toBe(wanted);
    expect(problemOf({ ...FILE, when: 'a task is created', which: 'FROM task' })).toBe(wanted);
    expect(
      problemOf({ ...FILE, when: 'a Meeting is created or changed', which: 'FROM Meeting' }),
    ).toBeNull();
  });

  it('lets a rule of Claude steps alone run on any trigger', () => {
    const steps = [
      { do: 'claude', prompt: '.atlas/prompts/a.md', output: 'proposals' },
      { do: 'claude', prompt: '.atlas/prompts/b.md', output: 'note', folder: 'Briefs' },
    ];
    expect(problemOf({ ...FILE, when: 'daily at 03:00', which: 'FROM task', steps })).toBeNull();
  });
});

describe('the "After a meeting" rule Atlas offers', () => {
  const action = AFTER_A_MEETING_PRESET.action as StepsAction;

  it('is a rule a file could hold: it saves, and reads back as itself', () => {
    expect(draftProblem(AFTER_A_MEETING_PRESET)).toBeNull();
    expect(actionOf(automationFrontmatter(AFTER_A_MEETING_PRESET))).toEqual(action);
    expect(AUTOMATION_PRESETS.map((preset) => preset.name)).toContain(AFTER_A_MEETING);
  });

  it('corrects, links, extracts and suggests terms, in that order, when a meeting is created', () => {
    expect(AFTER_A_MEETING_PRESET.when).toEqual({ kind: 'note', type: 'meeting', on: ['created'] });
    expect(action.steps.map(stepName)).toEqual([
      'correct-terms',
      'link-meeting',
      'claude meeting-items',
      'claude term-suggestions',
    ]);
    expect(claudeStepsOf(action).map((step) => step.prompt)).toEqual([
      MEETING_EXTRACTION_PROMPT,
      TERM_SUGGESTIONS_PROMPT,
    ]);
  });

  it('says what it does in a line, step by step', () => {
    expect(action.steps.map(describeStep)).toEqual([
      'Correct its terms',
      'Link its people and companies',
      'Ask Claude (meeting-extraction) for meeting-items',
      'Ask Claude (term-suggestions) for term-suggestions',
    ]);
    expect(describeAction(action)).toBe(describeSteps(action));
    expect(describeSteps(action)).toBe(
      'Correct its terms → Link its people and companies → Ask Claude (meeting-extraction) for meeting-items → Ask Claude (term-suggestions) for term-suggestions',
    );
  });
});

describe('what a rule of steps is planned and capped as', () => {
  const action = AFTER_A_MEETING_PRESET.action as StepsAction;
  const notes = (count: number) =>
    Array.from({ length: count }, (_, at) => createVaultPath(`Meetings/M${at}.md`));

  it('names its Claude steps, and none for a rule that asks nothing', () => {
    expect(claudeStepsOf(action)).toHaveLength(2);
    expect(claudeStepsOf({ kind: 'steps', steps: [{ kind: 'correct-terms' }] })).toEqual([]);
    expect(claudeStepsOf({ kind: 'archive' })).toEqual([]);
    const claude = claudeStepsOf(action)[0]!;
    expect(claudeStepsOf(claude)).toEqual([claude]);
  });

  it('is remembered note by note and takes as few notes a run as a Claude step does', () => {
    expect(remembersNotes(action)).toBe(true);
    expect(remembersNotes({ kind: 'archive' })).toBe(false);
    expect(remembersNotes({ kind: 'set', values: { status: 'done' } })).toBe(false);
    expect(capFor(action)).toBe(CLAUDE_NOTES_PER_RUN);
    const plan = planAutomation({ action, matched: notes(CLAUDE_NOTES_PER_RUN + 1) });
    expect(plan.paths).toHaveLength(CLAUDE_NOTES_PER_RUN);
    expect(plan.capped).toBe(true);
  });

  it('always has something to do to a note it matched', () => {
    expect(wouldChange(action, { status: 'done' })).toBe(true);
  });

  it('never takes a proposal or one of Atlas’s own files', () => {
    const plan = planAutomation({
      action,
      matched: [
        createVaultPath('Inbox/Proposals/Send the file.md'),
        createVaultPath('.atlas/types/meeting.md'),
        createVaultPath('Meetings/Standup.md'),
      ],
    });
    expect(plan.paths).toEqual(['Meetings/Standup.md']);
    expect(plan.passedOver.map((left) => left.path)).toEqual([
      'Inbox/Proposals/Send the file.md',
      '.atlas/types/meeting.md',
    ]);
  });

  it('says in a dry run how many steps, on how many notes, and names them in order', () => {
    expect(planVerb(action)).toBe('run its 4 steps on');
    expect(describePlan(planAutomation({ action, matched: notes(1) }))).toBe(
      'Would run its 4 steps on 1 note. For each, in order: Correct its terms → Link its people and companies → ' +
        'Ask Claude (meeting-extraction) for meeting-items → Ask Claude (term-suggestions) for term-suggestions. ' +
        'A step that fails stops the ones after it.',
    );
    expect(describePlan(planAutomation({ action, matched: [] }))).toMatch(
      /^Nothing to do right now\. For each, in order: Correct its terms/,
    );
  });
});
