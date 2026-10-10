// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, type ObjectType } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs, recordingActivity } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import type { OpenEditors } from '../panes/open-editors.ts';
import { useWeeklyReview, type WeeklyReviewOptions } from './use-weekly-review.ts';

/**
 * The review's writes and the Activity log: a task rule's refusal is shown
 * on the page and never recorded; and a task the review finishes is dated by
 * the review's own clock, the one its sections were read on.
 */
const TASK = createVaultPath('Tasks/Send Tobias the Larkspur file.md');
const TEXT = '---\ntype: task\nstatus: next-action\n---\n\n# Send\n';
const TYPES: readonly ObjectType[] = [{ name: 'task', label: 'Task', properties: [] }];
const NO_PANE = { setPropertiesIfOpen: async () => false } as unknown as OpenEditors;

function reviewing() {
  const activity = recordingActivity();
  const written: string[] = [];
  const fs = fakeVaultFs({
    readTextFile: async () => ({ text: TEXT, modified: 1 }),
    writeTextFile: async ({ contents }: { contents: string }) => {
      written.push(contents);
      return 2;
    },
  });
  const options: WeeklyReviewOptions = {
    ports: {
      index: fakeIndexPort({ query: async () => ({ columns: [], rows: [], truncated: false }) }),
      fs,
      markdown: remarkMarkdown,
    },
    editors: NO_PANE,
    clock: { today: () => '2031-02-03', now: () => Date.UTC(2031, 1, 3, 12) },
    types: TYPES,
    indexKey: '1',
    open: true,
    onSettled: vi.fn(),
    archiveNote: async () => null,
    activity,
  };
  const hook = renderHook(() => useWeeklyReview(options));
  return { activity, hook, written };
}

describe('the weekly review’s writes', () => {
  it('shows a task rule’s refusal and records nothing', async () => {
    const { activity, hook, written } = reviewing();
    await act(async () => hook.result.current.page.onSetStatus({ path: TASK, status: 'waiting' }));
    await waitFor(() => expect(hook.result.current.page.problem).toMatch(/waiting/i));
    expect(written).toEqual([]);
    expect(activity.reports).toEqual([]);
  });

  it('dates a task it finishes by its own clock', async () => {
    const { hook, written } = reviewing();
    await act(async () => hook.result.current.page.onArchiveTask(TASK));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toMatch(/^completed: 2031-02-03$/m);
  });
});
