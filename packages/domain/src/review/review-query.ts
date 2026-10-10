import { outsideArchiveSql } from '../archive/archive.ts';
import { FINISHED_TASK_STATUS, gtdStatusOf, TASK_KEYS, TASK_TYPE } from '../gtd/gtd-status.ts';
import { splitWikiLinks, wikiLinkLabel } from '../markdown/wikilink.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { FILED_UNDER_KEY, PROJECT_TYPE } from '../types/para.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { userSpaceNoteSql } from '../vault/vault-visibility.ts';
import { MOVING_STATUSES, type ReviewProject, type ReviewTask } from './weekly-review.ts';

/** What the review's statements start with, so a log or a stand-in index can tell them apart. */
export const REVIEW_TASKS_QUERY_MARK = '/* weekly review: tasks */';
export const REVIEW_PROJECTS_QUERY_MARK = '/* weekly review: projects */';

/** The key a project's status is kept under, as the Project type writes it. */
export const PROJECT_STATUS_KEY = 'status';

/** Between the items of a list the statement joins into one cell: a character no name holds. */
const ITEM_SEPARATOR = '\u001f';

/** A note at `column` of a type, in use: in user space and out of the Archive. */
function inUseOfTypeSql(column: string, typeParameter: string): string {
  return [
    `EXISTS (SELECT 1 FROM props AS ty WHERE ty.path = ${column} AND ty.key = 'type'`,
    `    AND lower(trim(ty.value_text)) = ${typeParameter})`,
    `  AND ${outsideArchiveSql(column)}`,
    `  AND ${userSpaceNoteSql(column)}`,
  ].join('\n');
}

/** A property's one value as text: null when it has none, or holds a list of several. */
const singleText = (key: string, column = 'f.path') =>
  `(SELECT CASE WHEN count(*) = 1 THEN max(p.value_text) END FROM props AS p WHERE p.path = ${column} AND p.key = '${key}')`;

/** A date property's first day, `YYYY-MM-DD`; null when it holds no date. */
const firstDay = (key: string) =>
  `(SELECT substr(p.value_date, 1, 10) FROM props AS p WHERE p.path = f.path AND p.key = '${key}' AND p.value_date IS NOT NULL ORDER BY p.idx LIMIT 1)`;

/**
 * Every item a property holds, in order, joined by {@link ITEM_SEPARATOR}:
 * text as written, a nested value as its JSON — as the task rules read it.
 */
const allItems = (key: string) =>
  `(SELECT group_concat(v, char(31)) FROM (SELECT coalesce(p.value_text, p.value_json) AS v FROM props AS p WHERE p.path = f.path AND p.key = '${key}' ORDER BY p.idx))`;

/**
 * The tasks the weekly review reads, asked of the index: every task in use
 * that is not finished — a finished task is in no section. Read whole, not a
 * page at a time: the review is of everything, and the index says when it
 * held back rows.
 */
export function compileReviewTasksQuery(): CompiledQuery {
  return {
    sql: [
      `${REVIEW_TASKS_QUERY_MARK} SELECT f.path AS "path", f.title AS "title", f.modified AS "modified",`,
      `  ${singleText(TASK_KEYS.status)} AS "status",`,
      `  ${firstDay(TASK_KEYS.due)} AS "due",`,
      `  ${firstDay(TASK_KEYS.defer)} AS "defer",`,
      `  ${allItems(TASK_KEYS.waitingOn)} AS "waitingOn",`,
      `  (SELECT r.dst FROM relations AS r WHERE r.src = f.path AND r.key = '${FILED_UNDER_KEY}' AND r.dst IS NOT NULL ORDER BY r.idx LIMIT 1) AS "project"`,
      `FROM files AS f`,
      `WHERE ${inUseOfTypeSql('f.path', '?')}`,
      `  AND NOT EXISTS (SELECT 1 FROM props AS s WHERE s.path = f.path AND s.key = '${TASK_KEYS.status}' AND s.value_text = ?)`,
      `ORDER BY f.path`,
    ].join('\n'),
    parameters: [TASK_TYPE, FINISHED_TASK_STATUS],
  };
}

/**
 * The projects the weekly review reads, asked of the index: every project in
 * use, and whether a task in use filed under it is moving. That is asked of
 * the index here rather than worked out from the tasks the review read, which
 * the host's row cap can cut short: a project is never called stalled on the
 * strength of tasks that were not read.
 */
export function compileReviewProjectsQuery(): CompiledQuery {
  const moving = MOVING_STATUSES.map(() => '?').join(', ');
  return {
    sql: [
      `${REVIEW_PROJECTS_QUERY_MARK} SELECT f.path AS "path", f.title AS "title",`,
      `  ${singleText(PROJECT_STATUS_KEY)} AS "status",`,
      `  EXISTS (SELECT 1 FROM relations AS r`,
      `    WHERE r.key = '${FILED_UNDER_KEY}' AND r.dst = f.path`,
      `      AND ${inUseOfTypeSql('r.src', '?')}`,
      `      AND ${singleText(TASK_KEYS.status, 'r.src')} IN (${moving})) AS "moving"`,
      `FROM files AS f`,
      `WHERE ${inUseOfTypeSql('f.path', '?')}`,
      `ORDER BY f.path`,
    ].join('\n'),
    parameters: [TASK_TYPE, ...MOVING_STATUSES, PROJECT_TYPE],
  };
}

const textOrNull = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * Who a task waits on, from its `waiting_on` items as the statement joined
 * them — a `[[link]]` by what it shows, a plain name as written — as the
 * task rules read them. '' for nobody.
 */
export function waitingOnNames(joined: unknown): string {
  if (typeof joined !== 'string') return '';
  return joined
    .split(ITEM_SEPARATOR)
    .map(shownName)
    .filter((name) => name !== '')
    .join(', ');
}

function shownName(item: string): string {
  return splitWikiLinks(item)
    .map((piece) => (piece.kind === 'text' ? piece.value : wikiLinkLabel(piece)))
    .join('')
    .trim();
}

/** A row of {@link compileReviewTasksQuery}, as the review reads it. */
export function reviewTask(row: Readonly<Record<string, unknown>>): ReviewTask {
  const project = textOrNull(row['project']);
  return {
    path: createVaultPath(String(row['path'])),
    title: String(row['title'] ?? ''),
    status: gtdStatusOf(row['status']),
    due: textOrNull(row['due']),
    defer: textOrNull(row['defer']),
    waitingOn: waitingOnNames(row['waitingOn']),
    project: project === null ? null : createVaultPath(project),
    modified: Number(row['modified']) || 0,
  };
}

/** A row of {@link compileReviewProjectsQuery}, as the review reads it. */
export function reviewProject(row: Readonly<Record<string, unknown>>): ReviewProject {
  return {
    path: createVaultPath(String(row['path'])),
    title: String(row['title'] ?? ''),
    status: textOrNull(row['status']),
    moving: Number(row['moving']) === 1,
  };
}
