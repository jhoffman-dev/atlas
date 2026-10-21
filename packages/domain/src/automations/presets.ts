import type { AutomationDraft } from './automation-rule.ts';
import { AFTER_A_MEETING_PROMPT, MEETING_EXTRACTION_PROMPT } from './built-in-prompts.ts';
import { MEETING_DIGEST_OUTPUT } from './meeting-digest.ts';
import { MEETING_ITEMS_OUTPUT } from './meeting-items.ts';

/**
 * The automations offered ready-made (P25-03). The first is James's own
 * (U-24): done tasks go to the Archive once they have sat untouched for 30
 * days. The query language cannot say "30 days ago", so the age is the rule's
 * own filter on `modified` rather than part of the query.
 *
 * The second is meeting extraction (P29-05): when a meeting arrives, Claude
 * pulls its action items and decisions out as proposals. Its prompt is one
 * DFAI ships, written into the vault when the rule is saved.
 *
 * The third is "After a meeting" (#179, ADR-0036): the declared step, which
 * says `apply: mine` so the owner's own action items may become tasks, asks
 * Sonnet on its own ask budget, and takes meetings of the last 14 days, so
 * turning it on cannot reach back through every meeting the vault holds. Its
 * answer is a `meeting-digest` (#184): the summary written at the top of the
 * meeting with the action items.
 */
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
  {
    name: 'After a meeting',
    enabled: true,
    when: { kind: 'note', type: 'meeting', on: ['created'] },
    which: 'FROM meeting WHERE date >= @-14d',
    olderThanDays: null,
    action: {
      kind: 'claude',
      prompt: AFTER_A_MEETING_PROMPT,
      tools: [],
      output: { kind: 'proposals', schema: MEETING_DIGEST_OUTPUT },
      apply: 'mine',
    },
  },
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
