/**
 * P31-01, adversarial: a schedule is refused rather than read short when the
 * index's row cap cuts it (ADR-0030). The cap is the host's; how many tasks
 * one question carries is Atlas's own choice, and should not be what refuses
 * a schedule every task of which the index can return whole.
 */
import { describe, expect, it } from 'vitest';
import { GTD_STATUS_PROPERTY, type ObjectType } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { readTaskSchedules } from './task-schedules.ts';

const GTD_TASK: ObjectType = { name: 'task', label: 'Task', properties: [GTD_STATUS_PROPERTY] };

/** The host's `MAX_QUERY_ROWS` (src-tauri/src/index.rs). */
const HOST_ROW_CAP = 5_000;

/** The index as the host answers it: at most its row cap, and says when it cut. */
function cappedIndex(notes: Record<string, unknown>): Pick<IndexPort, 'query'> {
  const files = Object.fromEntries(
    Object.entries(notes).map(([path, frontmatter]) => [path, jsonNote(frontmatter)]),
  );
  const real = atlasQueryIndex({ files, markdown: jsonMarkdown() });
  return {
    query: async (sql, parameters) => {
      const result = await real(sql, parameters);
      return {
        ...result,
        rows: result.rows.slice(0, HOST_ROW_CAP),
        truncated: result.rows.length > HOST_ROW_CAP,
      };
    },
  };
}

describe('readTaskSchedules at the row cap', () => {
  it('reads a page of tasks whose blocks together pass the cap, when each task’s alone fits it', async () => {
    // Two years of working mornings: 520 blocks of ten 15-minute tasks, among
    // 200 tasks, so each task is in 26 blocks — 260 rows of its own, far
    // inside the cap, but 5,200 rows for the 200 asked about together.
    const notes: Record<string, unknown> = {};
    const paths: string[] = [];
    for (let at = 0; at < 200; at += 1) {
      notes[`tasks/Task ${at}.md`] = { type: 'task', status: 'next-action', estimate: 15 };
      paths.push(`tasks/Task ${at}.md`);
    }
    for (let at = 0; at < 520; at += 1) {
      notes[`blocks/Morning ${at}.md`] = {
        type: 'block',
        start: '2026-10-12T09:00',
        end: '2026-10-12T11:30',
        tasks: Array.from({ length: 10 }, (_, offset) => `[[Task ${(at * 10 + offset) % 200}]]`),
      };
    }
    const index = cappedIndex(notes);

    // Each task alone reads whole.
    await expect(
      readTaskSchedules({ index, paths: ['tasks/Task 7.md'], taskType: GTD_TASK }),
    ).resolves.toBeDefined();

    const schedules = await readTaskSchedules({ index, paths, taskType: GTD_TASK });

    expect(schedules.size).toBe(200);
    expect(schedules.get('tasks/Task 7.md')).toEqual({
      estimate: 15,
      scheduled: 26 * 15,
      done: 0,
      overBy: 26 * 15 - 15,
    });
  }, 30_000);
});
