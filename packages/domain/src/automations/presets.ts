import type { AutomationDraft } from './automation-rule.ts';
import { MEETING_EXTRACTION_PROMPT } from './built-in-prompts.ts';
import { MEETING_ITEMS_OUTPUT } from './meeting-items.ts';

/**
 * The automations offered ready-made (P25-03). The first is James's own
 * (U-24): done tasks go to the Archive once they have sat untouched for 30
 * days. The query language cannot say "30 days ago", so the age is the rule's
 * own filter on `modified` rather than part of the query.
 *
 * The second is meeting extraction (P29-05): when a meeting arrives, Claude
 * pulls its action items and decisions out as proposals. Its prompt is one
 * Atlas ships, written into the vault when the rule is saved.
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
