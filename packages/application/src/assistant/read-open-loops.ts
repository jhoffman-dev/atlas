import {
  openLoopsOf,
  TASK_KEYS,
  type OpenLoops,
  type TaskStatusWords,
  type VaultPath,
} from '@dfai/domain';
import type { Clock } from '../ports.ts';
import { readLinkedPage } from '../linked-pages/read-linked-page.ts';
import {
  citedEntity,
  followUpsAround,
  itemContext,
  problemsOf,
  rowPaths,
  taskStatusWords,
  type AssistantReads,
  type CitedEntity,
  type SectionProblem,
} from './assistant-reads.ts';
import { readAssistantEntity } from './read-entity.ts';

/** `open_loops(entity)`: what is still open around a Person, Company, Project or Area, each item cited. */
export interface AssistantOpenLoops extends OpenLoops {
  readonly entity: CitedEntity;
  /** The day it was read, `YYYY-MM-DD`: what `overdue` and `waitingDays` are counted to. */
  readonly today: string;
  readonly problems: readonly SectionProblem[];
}

/** A Task type with no status of its own still has tasks; none of them is known to be finished. */
export const NO_STATUS: TaskStatusWords = { key: TASK_KEYS.status, done: null };

/**
 * A page's open tasks, waiting-fors and follow-ups (P32-04), read as its
 * linked page reads them (P30-06) — one bounded query a section — plus the
 * follow-ups made from its meetings and every item's `source`, one statement
 * each. Only the page's own note is read from the vault; nothing is written.
 */
export async function readOpenLoops({
  reads,
  clock,
  path,
}: {
  reads: AssistantReads;
  clock: Pick<Clock, 'today'>;
  path: VaultPath;
}): Promise<AssistantOpenLoops> {
  const entity = await readAssistantEntity({ ...reads, path, tool: 'open-loops' });
  const sections = await readLinkedPage({
    ...reads,
    clock,
    asWritten: true,
    notePath: path,
    typeName: entity.type,
    projectStatus: entity.status,
    ranges: { meetings: 'all' },
    only: ['tasks', 'waiting', 'meetings'],
  });
  const today = clock.today();
  const status = taskStatusWords(reads.types);
  const [context, followUps] = await Promise.all([
    itemContext({ reads, sourcePaths: rowPaths(sections, ['tasks', 'waiting']), day: today }),
    followUpsAround({
      ...reads,
      around: [path, ...rowPaths(sections, ['meetings'])],
      status,
    }),
  ]);
  const loops = openLoopsOf({ sections, followUps, status: status ?? NO_STATUS, context });
  return {
    entity: citedEntity(entity, context),
    today,
    ...loops,
    problems: problemsOf(sections),
  };
}
