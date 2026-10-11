/**
 * What a model needs to know to write a task's status as Atlas does
 * (ADR-0029). Said once, and read by every tool that writes one.
 */
export const TASK_STATUSES_DESCRIBED =
  'A task (type: task) in a vault on GTD has one of eight statuses: inbox, backlog, next-action, ' +
  'in-progress, waiting, someday, longterm, archive. Setting "waiting" needs "waiting_on", a ' +
  '[[Person]] link, set before or in the same call, or it is refused as invalid; setting ' +
  '"archive" finishes the task and sets "completed" to today, and moving it out of archive ' +
  'removes "completed". "defer" (a date) keeps it out of Next actions until that day.';
