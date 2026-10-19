/**
 * Every action the work budgets measure, in the order `budgets.spec.ts` does
 * them: each starts from where the one before left the app.
 */
export const BUDGETED_ACTIONS = [
  'Click a sidebar note',
  'Switch notes',
  'Open in a new tab',
  'Switch tabs',
  'Type 10 characters in a note',
  'One autosave and its watcher echo',
  'Idle 3 s with a note open',
  'Split the window',
  'Focus the other pane',
  'Close a pane',
  'Open Settings',
  'Open Today',
  'Idle 3 s on Today',
  'Tick a task on Today',
  'Open the Inbox',
  'Decide an Inbox row',
  "Open a person's page",
  'Open the 420-row table',
  '⌘K + 5 keys over the table',
  'Drag a board card',
] as const;

export type BudgetedAction = (typeof BUDGETED_ACTIONS)[number];
