/** The weekly review, read-only: `GET /v1/review/weekly` (P30-07). */

import { defineTool } from './define.ts';
import { noInput } from './inputs.ts';

export const weeklyReview = defineTool({
  name: 'atlas_weekly_review',
  title: 'Weekly review',
  description:
    "GTD's weekly review, as Atlas's Weekly review page shows it, read on the app's clock: " +
    '{ review: { today, staleWaiting, projectsWithoutNextAction, overdue, untouchedSomeday, ' +
    'inbox: { count, more }, truncated } }. staleWaiting: tasks Waiting and untouched for more ' +
    'than 7 days, with "waitingOn" (who, link or plain name). projectsWithoutNextAction: ' +
    'projects with status active and no task filed under them (by "project") that is ' +
    'next-action or in-progress. overdue: open tasks (inbox, backlog, next-action, ' +
    'in-progress, waiting) due before today. untouchedSomeday: someday and longterm tasks ' +
    'untouched for more than 30 days. A task is { path, title, status, due, defer, waitingOn, ' +
    'project, modified }, a project { path, title, status, moving }. "Untouched" is the ' +
    'file\'s last change; a task deferred past today is in no section until its "defer" day. ' +
    '"truncated" means tasks were held back, so a task section may be missing some. To act on ' +
    'an item as the page does: set its status or "defer" with atlas_update_properties (a late ' +
    'task leaves overdue only for someday, longterm, a later defer, or archive), or archive a ' +
    'project with atlas_archive. Setting status archive finishes a task and, for a repeating ' +
    'one (with "recurrence"), ends its series; the page instead rolls a repeating task on to ' +
    'its next due date at next-action.',
  inputSchema: noInput,
  annotations: { readOnlyHint: true },
  call: (client) => client.weeklyReview(),
});

export const reviewTools = [weeklyReview];
