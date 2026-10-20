import { REVIEW_SCOPE, type ReadScope } from '../reads/scoped-reads.ts';
import type { TodayReport } from './read-today.ts';

/**
 * What the Today page is made from once it has read (#392): what the review
 * reads, and the notes its listed tasks are filed under, whatever their type.
 * A task's `project:` can resolve to an untyped note, whose title heads the
 * task's group; its retitle, move or deletion re-resolves the task in the
 * index without changing the task's own text, so only the note's own path
 * names it in the news.
 */
export function todayScope(report: Pick<TodayReport, 'sections'> | null): ReadScope {
  const notes = new Set<string>();
  for (const section of report?.sections ?? []) {
    for (const group of section.groups) {
      for (const task of group.tasks) if (task.project !== null) notes.add(task.project);
    }
  }
  return notes.size === 0 ? REVIEW_SCOPE : { ...REVIEW_SCOPE, notes: [...notes] };
}
