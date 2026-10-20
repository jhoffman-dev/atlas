import { REVIEW_SCOPE, type ReadScope } from '../reads/scoped-reads.ts';
import type { TodayReport } from './read-today.ts';

/**
 * What the Today page is made from once it has read (#392): what the review
 * reads, the notes its listed tasks are filed under, whatever their type, and
 * the names their `project:` links by. A task's `project:` can resolve to an
 * untyped note, whose title heads the task's group; that note's retitle, move
 * or deletion — or a note made with a name a link was waiting for —
 * re-resolves the task in the index without changing the task's own text, so
 * only the note's own path, or its name, says so in the news.
 */
export function todayScope(report: Pick<TodayReport, 'sections'> | null): ReadScope {
  const notes = new Set<string>();
  const linkedNames = new Set<string>();
  // Every task, not each group's project: a section that is not grouped still
  // shows each task's project on its row.
  for (const section of report?.sections ?? []) {
    for (const group of section.groups) {
      for (const task of group.tasks) {
        if (task.project !== null) notes.add(task.project);
        for (const name of task.projectLinks ?? []) linkedNames.add(name);
      }
    }
  }
  if (notes.size === 0 && linkedNames.size === 0) return REVIEW_SCOPE;
  return { ...REVIEW_SCOPE, notes: [...notes], linkedNames: [...linkedNames] };
}
