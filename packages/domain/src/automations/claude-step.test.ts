import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  automationFrontmatter,
  describeAction,
  draftProblem,
  parseAutomationRule,
  wouldChange,
  type AutomationDraft,
} from './automation-rule.ts';
import { capFor, describePlan, planAutomation } from './automation-plan.ts';
import { CLAUDE_NOTES_PER_RUN, type ClaudeAction } from './claude-step.ts';
import { MAX_ACTIONS_PER_RUN } from './automation-query.ts';

/**
 * P29-03: a rule's Claude step, as its file writes it. It names a prompt in
 * `.atlas/prompts/`, some of the chat's read tools, and an output — proposals,
 * or one new note in a declared folder. Any output that would edit a note is
 * refused here, so such a rule is broken and never runs.
 */

const PATH = createVaultPath('.atlas/automations/Meeting actions.md');

const RULE = {
  atlas: 'automation',
  name: 'Meeting actions',
  enabled: true,
  when: 'a meeting is created',
  which: 'FROM meeting',
  do: 'claude',
  prompt: '.atlas/prompts/meeting-actions.md',
  tools: ['atlas_read_note', 'atlas_search'],
  output: 'proposals',
};

const read = (frontmatter: Record<string, unknown>) => parseAutomationRule(PATH, frontmatter);
const problemOf = (frontmatter: Record<string, unknown>): string | null => {
  const parsed = read(frontmatter);
  return 'broken' in parsed ? parsed.broken.problem : null;
};
const actionOf = (frontmatter: Record<string, unknown>) => {
  const parsed = read(frontmatter);
  if ('broken' in parsed) throw new Error(parsed.broken.problem);
  return parsed.rule.action;
};

describe('a rule with a Claude step', () => {
  it('reads its prompt, its tools and a proposals output', () => {
    expect(actionOf(RULE)).toEqual({
      kind: 'claude',
      prompt: '.atlas/prompts/meeting-actions.md',
      tools: ['atlas_read_note', 'atlas_search'],
      output: { kind: 'proposals', schema: 'proposals' },
    });
  });

  it('reads a note output with the folder its one new note goes in', () => {
    const action = actionOf({ ...RULE, output: 'note', folder: 'Briefs/' });
    expect(action).toMatchObject({ output: { kind: 'note', folder: 'Briefs' } });
  });

  it('takes a prompt named without its folder or extension as one in .atlas/prompts', () => {
    expect(actionOf({ ...RULE, prompt: 'meeting-actions' })).toMatchObject({
      prompt: '.atlas/prompts/meeting-actions.md',
    });
  });

  it('takes no tools as none, and a tool named twice once', () => {
    const withoutTools = Object.fromEntries(
      Object.entries(RULE).filter(([key]) => key !== 'tools'),
    );
    expect(actionOf(withoutTools)).toMatchObject({ tools: [] });
    expect(actionOf({ ...RULE, tools: ['atlas_search', 'atlas_search'] })).toMatchObject({
      tools: ['atlas_search'],
    });
  });

  it('refuses a prompt outside .atlas/prompts, or in a folder below it, or none', () => {
    const wanted = 'Name its prompt: prompt: .atlas/prompts/<name>.md.';
    expect(problemOf({ ...RULE, prompt: 'Notes/prompt.md' })).toBe(wanted);
    expect(problemOf({ ...RULE, prompt: '.atlas/prompts/deep/prompt.md' })).toBe(wanted);
    expect(problemOf({ ...RULE, prompt: '../outside.md' })).toBe(wanted);
    expect(problemOf({ ...RULE, prompt: undefined })).toBe(wanted);
  });

  it('refuses a tool that is not one of the chat’s read tools, naming it', () => {
    expect(problemOf({ ...RULE, tools: ['atlas_search', 'propose_edit'] })).toMatch(
      /only the read tools .*“propose_edit” is not one\./,
    );
    expect(problemOf({ ...RULE, tools: 'atlas_search' })).toBe(
      'Write tools: as a list, like tools: [atlas_read_note].',
    );
  });

  it('refuses every output that would edit a note, saying a Claude step never does', () => {
    for (const output of ['edit', 'Edits', 'update', 'append', 'replace', 'set', 'patch']) {
      expect(problemOf({ ...RULE, output })).toBe(
        'A Claude step never edits a note: it writes proposals for you to accept, or one new note.',
      );
    }
  });

  it('refuses a note output that names a note by path: writing it would be an edit', () => {
    expect(problemOf({ ...RULE, output: 'note', folder: 'Briefs', path: 'Briefs/Today.md' })).toBe(
      'A Claude step never edits a note: it writes proposals for you to accept, or one new note.',
    );
  });

  it('refuses a note output without a folder, or with one a proposal may not write in', () => {
    expect(problemOf({ ...RULE, output: 'note' })).toBe(
      'Say which folder its note goes in: folder: Briefs.',
    );
    expect(problemOf({ ...RULE, output: 'note', folder: '.atlas/prompts' })).toMatch(
      /hidden configuration.*a Claude step does not write there/,
    );
    expect(problemOf({ ...RULE, output: 'note', folder: 'Archive/Briefs' })).toMatch(/Archive/);
    expect(problemOf({ ...RULE, output: 'note', folder: 'Inbox/Proposals' })).toMatch(
      /where proposals wait/,
    );
  });

  it('refuses an output it does not know, naming those it does', () => {
    expect(problemOf({ ...RULE, output: 'summary' })).toBe(
      'Say what Claude writes: output: one of note, proposals.',
    );
  });

  it('is written back to its file as it was read, and a rule that stops asking Claude drops the keys', () => {
    const parsed = read({ ...RULE, output: 'note', folder: 'Briefs' });
    if ('broken' in parsed) throw new Error(parsed.broken.problem);
    const written = automationFrontmatter(parsed.rule);
    expect(written).toMatchObject({
      do: 'claude',
      prompt: '.atlas/prompts/meeting-actions.md',
      tools: ['atlas_read_note', 'atlas_search'],
      output: 'note',
      folder: 'Briefs',
      set: null,
    });
    expect(read(written)).toMatchObject({ rule: { action: parsed.rule.action } });
    const archiving = automationFrontmatter({ ...parsed.rule, action: { kind: 'archive' } });
    expect(archiving).toMatchObject({ prompt: null, tools: null, output: null, folder: null });
  });

  it('holds a draft from the editor to the same rules as a file', () => {
    const parsed = read(RULE);
    if ('broken' in parsed) throw new Error(parsed.broken.problem);
    const draft: AutomationDraft = parsed.rule;
    expect(draftProblem(draft)).toBeNull();
    const editing: ClaudeAction = {
      kind: 'claude',
      prompt: createVaultPath('Notes/prompt.md'),
      tools: [],
      output: { kind: 'proposals', schema: 'proposals' },
    };
    expect(draftProblem({ ...draft, action: editing })).toMatch(/Name its prompt/);
  });

  it('is described as the prompt it asks and what it writes', () => {
    expect(describeAction(actionOf(RULE))).toBe('Ask Claude (meeting-actions) for proposals');
    expect(describeAction(actionOf({ ...RULE, output: 'note', folder: 'Briefs' }))).toBe(
      'Ask Claude (meeting-actions) for a note in Briefs',
    );
  });
});

describe('planning a Claude step', () => {
  const action = actionOf(RULE);
  const paths = (count: number) =>
    Array.from({ length: count }, (_, at) => createVaultPath(`Meetings/M${at}.md`));

  it('reads at most ten notes a run, far fewer than a move takes', () => {
    expect(capFor(action)).toBe(CLAUDE_NOTES_PER_RUN);
    expect(CLAUDE_NOTES_PER_RUN).toBeLessThan(MAX_ACTIONS_PER_RUN);
    const plan = planAutomation({ action, matched: paths(CLAUDE_NOTES_PER_RUN + 1) });
    expect(plan.paths).toHaveLength(CLAUDE_NOTES_PER_RUN);
    expect(plan.capped).toBe(true);
    expect(planAutomation({ action: { kind: 'archive' }, matched: paths(11) }).capped).toBe(false);
  });

  it('passes over proposals, which it would answer with more proposals, and Atlas’s own files', () => {
    const plan = planAutomation({
      action,
      matched: [
        createVaultPath('Inbox/Proposals/Send the file.md'),
        createVaultPath('.atlas/prompts/meeting-actions.md'),
        createVaultPath('Meetings/Standup.md'),
      ],
    });
    expect(plan.paths).toEqual(['Meetings/Standup.md']);
    expect(plan.passedOver.map((over) => over.reason)).toEqual([
      'A Claude step does not read proposals: it would be answering itself.',
      'Atlas keeps its own files as they are.',
    ]);
  });

  it('says what it would do in words, and always counts as a change', () => {
    const plan = planAutomation({ action, matched: paths(2) });
    expect(describePlan(plan)).toBe('Would ask Claude about 2 notes.');
    expect(wouldChange(action, { anything: 'at all' })).toBe(true);
  });
});
