import { describe, expect, it } from 'vitest';
import { REVIEW_TASKS_QUERY_MARK, taskRuleChanges } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown } from '../testing/fake-ports.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { readWeeklyReview } from './read-weekly-review.ts';

/** P30-07, adversarial: the weekly review read from a real index, on a fixed clock. */
const NOW = Date.UTC(2026, 9, 8, 12);
const DAY = 86_400_000;
const CLOCK = { today: () => '2026-10-08', now: () => NOW };

const note = (frontmatter: readonly string[]) => ['---', ...frontmatter, '---', ''].join('\n');
const titles = (items: readonly { title: string }[]) => items.map((item) => item.title);

describe('readWeeklyReview, adversarial', () => {
  it('names who a stale Waiting task waits on when waiting_on is a plain name, not a link', async () => {
    const frontmatter = { type: 'task', status: 'waiting', waiting_on: 'Tobias Fenn' };
    // The task rules hold this task to be waiting on someone: it is a valid Waiting task.
    expect(
      taskRuleChanges({ before: {}, changes: frontmatter, today: '2026-10-08' }),
    ).not.toHaveProperty('refused');
    const files = {
      'Tasks/Signed lease.md': note(['type: task', 'status: waiting', 'waiting_on: Tobias Fenn']),
    };
    const query = atlasQueryIndex({
      markdown: fakeMarkdown(),
      files,
      modified: { 'Tasks/Signed lease.md': NOW - 10 * DAY },
    });
    const review = await readWeeklyReview({ index: fakeIndexPort({ query }), clock: CLOCK });

    expect(titles(review.staleWaiting)).toEqual(['Signed lease']);
    // Observed: '' — the page says "Waiting on nobody" and the API/MCP report nobody.
    expect(review.staleWaiting[0]?.waitingOn).toBe('Tobias Fenn');
  });

  it('does not say an active project has nothing next on the strength of a truncated read', async () => {
    const files = {
      'Projects/Atlas.md': note(['type: project', 'status: active']),
      'Tasks/A first idea.md': note(['type: task', 'status: someday']),
      'Tasks/Ship the review.md': note([
        'type: task',
        'status: next-action',
        'project: "[[Atlas]]"',
      ]),
    };
    const query = atlasQueryIndex({ markdown: fakeMarkdown(), files });
    // The host stops at its row cap (5,000) in path order: here, after the first task.
    const capped = fakeIndexPort({
      query: async (sql, parameters) => {
        const result = await query(sql, parameters);
        return sql.startsWith(REVIEW_TASKS_QUERY_MARK)
          ? { ...result, rows: result.rows.slice(0, 1), truncated: true }
          : result;
      },
    });
    const review = await readWeeklyReview({ index: capped, clock: CLOCK });

    expect(review.truncated).toBe(true);
    // Observed: ['Atlas'] — its next action was beyond the cap, so it is listed as having none,
    // while the page's banner only warns that items may be *missing*.
    expect(titles(review.projectsWithoutNextAction)).toEqual([]);
  });
});
