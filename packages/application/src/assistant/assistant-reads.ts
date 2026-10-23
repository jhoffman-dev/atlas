import {
  compileFollowUpsQuery,
  compileSourcesQuery,
  followUpRowsOf,
  linkingAmong,
  noteCitation,
  sourcesOf,
  statusOf,
  taskTypeOf,
  type AnsweredSection,
  type Citation,
  type FollowUpRow,
  type ItemContext,
  type ObjectType,
  type TaskStatusWords,
  type VaultPath,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import type { AssistantEntity } from './read-entity.ts';

/*
 * What the assistant's tools share (P32-04): the ports and the vault's types
 * and notes they read with, and the two index questions — sources and
 * follow-ups — each answered in one statement.
 */

/** What every assistant read is asked with. */
export interface AssistantReads {
  readonly index: IndexPort;
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly types: readonly ObjectType[];
  readonly notePaths: readonly VaultPath[];
}

/** The page an answer is about, cited like every item in it. */
export interface CitedEntity {
  readonly path: string;
  readonly title: string;
  readonly type: string;
  readonly cite: Citation;
}

/** A section of the page that could not be answered, and why; the others still stand. */
export interface SectionProblem {
  readonly section: string;
  readonly problem: string;
}

/** The status words of the vault's Task type: `status`, finished by `archive`, unless it says otherwise. */
export function taskStatusWords(types: readonly ObjectType[]): TaskStatusWords | null {
  const status = statusOf(taskTypeOf(types));
  return status === null ? null : { key: status.key, done: status.done };
}

/** The entity, cited, as an answer starts with it. */
export function citedEntity(entity: AssistantEntity, context: ItemContext): CitedEntity {
  return {
    path: entity.path,
    title: entity.title,
    type: entity.type,
    cite: noteCitation(entity.path, context.targetOf),
  };
}

/** Each unanswerable section, said once. */
export function problemsOf(sections: readonly AnsweredSection[]): SectionProblem[] {
  return sections.flatMap((section) =>
    section.problem === null ? [] : [{ section: section.id, problem: section.problem }],
  );
}

/** The `source` of every one of these notes, read in one statement. */
async function sourcesFor(
  index: IndexPort,
  paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const compiled = compileSourcesQuery(paths);
  if (compiled === null) return new Map();
  return sourcesOf((await index.query(compiled.sql, compiled.parameters)).rows);
}

/** How the items of an answer are cited: links among the vault's notes, and each item's `source`. */
export async function itemContext({
  reads,
  sourcePaths,
  day,
}: {
  reads: AssistantReads;
  /** The tasks and decisions whose `source` an item cites. */
  sourcePaths: readonly string[];
  day: string;
}): Promise<ItemContext> {
  const sources = await sourcesFor(reads.index, sourcePaths);
  return { ...linkingAmong(reads.notePaths), sources, day };
}

/** The open follow-ups linked with the page or any of its meetings; none without a Task status. */
export async function followUpsAround({
  index,
  types,
  around,
  status,
}: {
  index: IndexPort;
  types: readonly ObjectType[];
  around: readonly string[];
  status: TaskStatusWords | null;
}): Promise<FollowUpRow[]> {
  const task = taskTypeOf(types);
  if (task === null || status === null) return [];
  const compiled = compileFollowUpsQuery({
    around,
    taskType: task.name,
    statusKey: status.key,
    done: status.done,
  });
  if (compiled === null) return [];
  return followUpRowsOf((await index.query(compiled.sql, compiled.parameters)).rows);
}

/** The paths of the rows of these sections. */
export function rowPaths(
  sections: readonly AnsweredSection[],
  ids: readonly AnsweredSection['id'][],
): string[] {
  return sections
    .filter((section) => ids.includes(section.id))
    .flatMap((section) => section.rows.map((row) => row.path));
}
