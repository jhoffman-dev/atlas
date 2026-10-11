/**
 * Adversarial (P30-01): a relation may point at several types — `project`
 * pointing at a project or an area. A board grouped by it gives a column to
 * every note the relation can point at (issue #6), so an area with nothing
 * filed under it yet must have its column as an empty project does.
 */

import { describe, expect, it } from 'vitest';
import type { IndexPort } from '../index/ports.ts';
import { apiFixture, bodyOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const TASK = jsonNote({
  name: 'task',
  label: 'Task',
  properties: { project: { kind: 'relation', target: ['project', 'area'] } },
});

const ROWS: Record<string, unknown>[] = [
  { path: 'A.md', title: 'A', project: '[[Atlas]]' },
  { path: 'B.md', title: 'B', project: null },
];

function vault() {
  const index: Partial<IndexPort> = {
    query: async (text: string) => {
      if (text.includes('graph:namedNotes')) {
        return {
          columns: ['path', 'title'],
          rows: [
            ['Projects/Atlas.md', 'Atlas'],
            ['Areas/Garden.md', 'Garden'],
          ],
          truncated: false,
        };
      }
      const columns = ['path', 'title', ...(text.includes('"project"') ? ['project'] : [])];
      return {
        columns,
        rows: ROWS.map((row) => columns.map((column) => row[column] ?? null)),
        truncated: false,
      };
    },
    notesOfType: async (type: string) => {
      if (type === 'project') return [{ path: 'Projects/Atlas.md', title: 'Atlas' }];
      if (type === 'area') return [{ path: 'Areas/Garden.md', title: 'Garden' }];
      return [];
    },
  };
  return apiFixture({
    markdown: jsonMarkdown(),
    index,
    files: {
      '.atlas/types/task.md': TASK,
      '.atlas/views/Projects.md': jsonNote({
        atlas: 'view',
        type: 'task',
        columns: ['title'],
        layout: 'board',
        groupBy: 'project',
      }),
    },
  });
}

type Group = { label: string; rows: number[]; groups: Group[] };

describe('POST /v1/views/{path}/run — a relation pointing at several types', () => {
  it('gives an area with nothing filed under it a column, as it does an empty project', async () => {
    const api = vault();

    const body = bodyOf(
      await api.send({
        method: 'POST',
        path: `/v1/views/${encoded('.atlas/views/Projects.md')}/run`,
      }),
    );

    const labels = (body['groups'] as Group[]).map((group) => group.label);
    expect(labels).toContain('Atlas');
    expect(labels).toContain('Garden');
  });
});
