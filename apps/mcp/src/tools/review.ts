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
    'than 7 days, with "waitingOn" (who). projectsWithoutNextAction: projects with status ' +
    'active and no task filed under them (by "project") that is next-action or in-progress. ' +
    'overdue: open tasks (inbox, backlog, next-action, in-progress, waiting) due before today. ' +
    'untouchedSomeday: someday and longterm tasks untouched for more than 30 days. A task is ' +
    '{ path, title, status, due, defer, waitingOn, project, modified }, a project ' +
    '{ path, title, status }. "Untouched" is the file\'s last change; a task deferred past ' +
    'today is in no section until its "defer" day. To act on an item, as the page does: set ' +
    'its status or "defer" with atlas_update_properties, or archive a project with ' +
    'atlas_archive.',
  inputSchema: noInput,
  annotations: { readOnlyHint: true },
  call: (client) => client.weeklyReview(),
});

export const reviewTools = [weeklyReview];
