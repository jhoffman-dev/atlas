/**
 * P31-02: the planning tray's tasks, read from an index built from the notes
 * the way refreshing it builds it, so the Next actions query and the schedule
 * run for real against SQLite.
 */
import { describe, expect, it } from 'vitest';
import { BLOCK_TYPE_FILE, TASK_TYPE_FILE } from '@atlas/domain';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { readPlanTray } from './plan-tray.ts';

const TYPES = [TASK_TYPE_FILE.type, BLOCK_TYPE_FILE.type];

const indexOf = (notes: Record<string, unknown>) => {
  const files = Object.fromEntries(
    Object.entries(notes).map(([path, frontmatter]) => [path, jsonNote(frontmatter)]),
  );
  return fakeIndexPort({ query: atlasQueryIndex({ files, markdown: jsonMarkdown() }) });
};

const task = (status: string, estimate: number | null = 60, due?: string) => ({
  type: 'task',
  status,
  ...(estimate !== null && { estimate }),
  ...(due !== undefined && { due }),
});
const block = (start: string, end: string, ...tasks: string[]) => ({
  type: 'block',
  start,
  end,
  tasks: tasks.map((name) => `[[${name}]]`),
});

describe('the planning tray', () => {
  it('offers the next actions alone, the ones with no time set aside first, each with its schedule', async () => {
    const index = indexOf({
      'Book the hall.md': task('next-action', 60, '2026-10-01'),
      'Call the bank.md': task('next-action', 30, '2026-10-02'),
      'Draft the memo.md': task('in-progress'),
      'Sort the post.md': task('inbox'),
      'Hall time.md': block('2026-10-12T09:00', '2026-10-12T09:45', 'Book the hall'),
    });

    const tray = await readPlanTray({
      index,
      types: TYPES,
      notePaths: [
        'Book the hall.md',
        'Call the bank.md',
        'Draft the memo.md',
        'Sort the post.md',
        'Hall time.md',
      ],
    });

    expect(tray).toEqual([
      {
        path: 'Call the bank.md',
        title: 'Call the bank',
        schedule: { estimate: 30, scheduled: 0, done: 0, overBy: 0 },
      },
      {
        path: 'Book the hall.md',
        title: 'Book the hall',
        schedule: { estimate: 60, scheduled: 45, done: 0, overBy: 0 },
      },
    ]);
  });

  it('is empty when there is nothing to do next', async () => {
    const index = indexOf({ 'Sort the post.md': task('inbox') });

    expect(await readPlanTray({ index, types: TYPES, notePaths: ['Sort the post.md'] })).toEqual(
      [],
    );
  });
});
