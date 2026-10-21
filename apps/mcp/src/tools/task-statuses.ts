/**
 * What a model needs to know to write a task's status as DFAI does
 * (ADR-0029). Said once, and read by every tool that writes one.
 */
export const TASK_STATUSES_DESCRIBED =
  'A task (type: task) in a vault on GTD has one of eight statuses: inbox, backlog, next-action, ' +
  'in-progress, waiting, someday, longterm, archive. Setting "waiting" never needs ' +
  '"waiting_on": who it waits on (a [[Person]] link or a plain name) is optional; setting ' +
  '"archive" finishes the task and sets "completed" to today, and moving it out of archive ' +
  'removes "completed". "defer" (a date) keeps it out of Next actions until that day.';
