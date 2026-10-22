/** The weekly review and the Today page, read-only: `GET /v1/review/weekly` (P30-07), `GET /v1/today` (#111). */

import { defineTool } from './define.ts';
import { noInput } from './inputs.ts';

export const weeklyReview = defineTool({
  name: 'atlas_weekly_review',
  title: 'Weekly review',
  description:
    "GTD's weekly review, as DFAI's Weekly review page shows it, read on the app's clock: " +
    '{ review: { today, staleWaiting, projectsWithoutNextAction, overdue, untouchedSomeday, ' +
    'inbox: { count, toFile, toAnswer, more }, truncated } }. inbox counts the one Inbox as ' +
    'the sidebar does: notes to file plus proposals to answer. ' +
    'staleWaiting: tasks Waiting and untouched for more ' +
    'than 7 days, with "waitingOn" (who, link or plain name). projectsWithoutNextAction: ' +
    'projects with status active and no task filed under them (by "project") that is ' +
    'next-action or in-progress. overdue: open tasks (inbox, backlog, next-action, ' +
    'in-progress, waiting) due before today. untouchedSomeday: someday and longterm tasks ' +
    'untouched for more than 30 days. A task is { path, title, status, due, defer, recurrence, ' +
    'waitingOn, contexts, project, projectTitle, modified } ("recurrence" how it repeats, null ' +
    'when it does not), a project { path, title, status, moving }. "Untouched" is the ' +
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

export const today = defineTool({
  name: 'atlas_today',
  title: 'Today',
  description:
    "What needs the person today, as DFAI's Today page shows it, read on the app's clock: " +
    '{ today: { today, sections, stalledProjects, inbox: { count, toFile, toAnswer, more }, ' +
    'truncated } }. sections are always these six, in order, each { id, count, groups }: ' +
    'overdue (open tasks due before today), dueToday, backToday (tasks whose "defer" is ' +
    'today, any open status, and inbox, backlog, someday or longterm tasks whose "defer" ' +
    'day has passed), inProgress, nextActions (grouped by project, those under none ' +
    'last), waiting (grouped by who is waited on). A task is in one section only, the first ' +
    'that claims it, and a task deferred past today is in none. A group is { key, label, ' +
    'project, tasks }; a task is { path, title, status, due, defer, recurrence, waitingOn, ' +
    'contexts, project, projectTitle, modified, waitingDays } ("recurrence" how it repeats, ' +
    'null when it does not). waitingDays, for a waiting task, is whole ' +
    "days since the file's last change, not since it began waiting: any edit restarts it. " +
    'stalledProjects counts active projects with no next-action or in-progress task (listed ' +
    'by atlas_weekly_review). To act on a task as the page does, use atlas_update_properties: ' +
    'set "status", or set "defer" to a later day (YYYY-MM-DD) to take it off the page until ' +
    'then. Status waiting never needs "waiting_on"; set it too only to say who. Setting status ' +
    'archive finishes a task and, for a repeating one (with "recurrence"), ends its series; ' +
    "the page's tick instead rolls a repeating task on to its next due date.",
  inputSchema: noInput,
  annotations: { readOnlyHint: true },
  call: (client) => client.today(),
});

export const reviewTools = [weeklyReview, today];
