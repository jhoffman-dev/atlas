import type { AutomationDraft } from './automation-rule.ts';
import { MEETING_EXTRACTION_PROMPT, TERM_SUGGESTIONS_PROMPT } from './built-in-prompts.ts';
import { MEETING_ITEMS_OUTPUT } from './meeting-items.ts';
import { CORRECT_TERMS_STEP, LINK_MEETING_STEP, STEPS_ACTION } from './rule-steps.ts';
import { TERM_SUGGESTIONS_OUTPUT } from './term-suggestions.ts';

/**
 * The automations offered ready-made (P25-03). The first is James's own
 * (U-24): done tasks go to the Archive once they have sat untouched for 30
 * days. The query language cannot say "30 days ago", so the age is the rule's
 * own filter on `modified` rather than part of the query.
 *
 * The second is meeting extraction (P29-05): when a meeting arrives, Claude
 * pulls its action items and decisions out as proposals. Its prompt is one
 * Atlas ships, written into the vault when the rule is saved.
 *
 * The third is the whole of it (P29-06): "After a meeting" runs every step a
 * new meeting gets, in order, in one rule — and is what the Automations
 * page's one switch turns on.
 */

/** The "After a meeting" rule's name: its file is named after it, which is how the switch finds it. */
export const AFTER_A_MEETING = 'After a meeting';

/**
 * Everything Atlas does when a meeting arrives, as one rule (P29-06): its
 * terms corrected and its people linked — both done already by the import for
 * a meeting it let in, and done here for one that reached the vault another
 * way — then its actions and decisions pulled out, then the spellings that
 * look like misheard names suggested as terms.
 */
export const AFTER_A_MEETING_PRESET: AutomationDraft = {
  name: AFTER_A_MEETING,
  enabled: true,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
  which: 'FROM meeting',
  olderThanDays: null,
  action: {
    kind: STEPS_ACTION,
    steps: [
      { kind: CORRECT_TERMS_STEP },
      { kind: LINK_MEETING_STEP },
      {
        kind: 'claude',
        prompt: MEETING_EXTRACTION_PROMPT,
        tools: [],
        output: { kind: 'proposals', schema: MEETING_ITEMS_OUTPUT },
      },
      {
        kind: 'claude',
        prompt: TERM_SUGGESTIONS_PROMPT,
        tools: [],
        output: { kind: 'proposals', schema: TERM_SUGGESTIONS_OUTPUT },
      },
    ],
  },
};

export const AUTOMATION_PRESETS: readonly AutomationDraft[] = [
  {
    name: 'Archive done tasks after 30 days',
    enabled: true,
    when: { kind: 'daily', at: '03:00' },
    which: 'FROM task WHERE status = done',
    olderThanDays: 30,
    action: { kind: 'archive' },
  },
  {
    name: 'Pull actions and decisions out of a new meeting',
    enabled: true,
    when: { kind: 'note', type: 'meeting', on: ['created'] },
    which: 'FROM meeting',
    olderThanDays: null,
    action: {
      kind: 'claude',
      prompt: MEETING_EXTRACTION_PROMPT,
      tools: [],
      output: { kind: 'proposals', schema: MEETING_ITEMS_OUTPUT },
    },
  },
  AFTER_A_MEETING_PRESET,
];

/** A blank rule for the editor to start from. */
export const BLANK_AUTOMATION: AutomationDraft = {
  name: '',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: '',
  olderThanDays: null,
  action: { kind: 'archive' },
};
