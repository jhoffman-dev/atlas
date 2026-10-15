import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../markdown/markdown-document.ts';
import { draftProblem } from './automation-rule.ts';
import {
  BUILT_IN_PROMPTS,
  builtInPromptAt,
  MEETING_EXTRACTION_PROMPT,
} from './built-in-prompts.ts';
import { isPromptPath } from './claude-step.ts';
import { AUTOMATION_PRESETS } from './presets.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';

/** P29-05: the prompt Atlas ships for meeting extraction, and the ready-made rule that names it. */
describe('the prompts Atlas ships', () => {
  it('are prompt notes a rule can name, each with words to ask', () => {
    expect(BUILT_IN_PROMPTS.map((prompt) => prompt.path)).toEqual([
      '.atlas/prompts/meeting-extraction.md',
      '.atlas/prompts/after-a-meeting.md',
    ]);
    for (const prompt of BUILT_IN_PROMPTS) {
      expect(isPromptPath(prompt.path)).toBe(true);
      // What a step is asked is the note's body: it must not be read as empty.
      expect(splitFrontmatter(prompt.contents).body.trim()).toBe(prompt.contents.trim());
      expect(builtInPromptAt(prompt.path)).toBe(prompt);
    }
    expect(builtInPromptAt('.atlas/prompts/mine.md')).toBeNull();
  });

  it('tells meeting extraction the rules its output cannot check for it', () => {
    const { contents } = builtInPromptAt(MEETING_EXTRACTION_PROMPT)!;

    for (const rule of [
      'Only real commitments.',
      'written **You** in the transcript',
      'Do not guess a person.',
      'Cite one turn.',
      'hints, not a source',
      'Confidence means how sure you are',
    ]) {
      expect(contents).toContain(rule);
    }
  });
});

describe('the ready-made meeting extraction rule', () => {
  const preset = AUTOMATION_PRESETS.find((each) => each.action.kind === 'claude')!;

  it('is a whole rule: set off by a new meeting, asking the shipped prompt for meeting-items', () => {
    expect(draftProblem(preset)).toBeNull();
    expect(preset.when).toEqual({ kind: 'note', type: 'meeting', on: ['created'] });
    expect(preset.action).toEqual({
      kind: 'claude',
      prompt: MEETING_EXTRACTION_PROMPT,
      tools: [],
      output: { kind: 'proposals', schema: 'meeting-items' },
    });
    expect(proposalSchemaNamed('meeting-items')).not.toBeNull();
  });
});
