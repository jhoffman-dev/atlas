import type { AutomationDraft } from './automation-rule.ts';

/**
 * The automations offered ready-made (P25-03). The first is James's own
 * (U-24): done tasks go to the Archive once they have sat untouched for 30
 * days. The query language cannot say "30 days ago", so the age is the rule's
 * own filter on `modified` rather than part of the query.
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
