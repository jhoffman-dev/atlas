// @vitest-environment jsdom
/**
 * Filing a note from the Inbox and the Activity log: a project the rules
 * refuse is shown and not recorded; a filing the page gave up on is recorded
 * once, naming the note.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  fakeIndexPort,
  fakeMarkdown,
  fakeVaultFs,
  recordingActivity,
  type ArchivePorts,
} from '@atlas/application';
import { createVaultPath } from '@atlas/domain';
import { useInbox } from './use-inbox.ts';

const NOTE = createVaultPath('Inbox/Call Mara.md');

function filing(readProject: () => Promise<{ text: string; modified: number }>) {
  const ports: ArchivePorts = {
    fs: fakeVaultFs({ readTextFile: readProject }),
    markdown: fakeMarkdown(),
    index: fakeIndexPort({
      query: async () => ({ columns: ['path', 'title', 'type'], rows: [], truncated: false }),
    }),
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  const activity = recordingActivity();
  const notePaths = [NOTE, createVaultPath('Projects/Atlas.md')];
  const hook = renderHook(() =>
    useInbox({ ports, notePaths, indexKey: '1', open: false, onSettled: () => {}, activity }),
  );
  const file = () =>
    act(() =>
      hook.result.current.process({ path: NOTE, project: createVaultPath('Projects/Atlas.md') }),
    );
  return { hook, activity, file };
}

describe('filing from the Inbox, and the Activity log', () => {
  it('shows a refused project and records nothing', async () => {
    const { hook, activity, file } = filing(async () => ({
      text: '---\ntype: person\n---\n',
      modified: 1,
    }));
    await file();
    await waitFor(() => expect(hook.result.current.problem).toMatch(/links to a project or area/));
    expect(activity.reports).toEqual([]);
  });

  it('records once a filing it gave up on', async () => {
    const { hook, activity, file } = filing(async () => {
      throw new Error('The disk is not answering.');
    });
    await file();
    await waitFor(() => expect(hook.result.current.problem).toBe('The disk is not answering.'));
    expect(activity.reports).toEqual([
      expect.objectContaining({
        level: 'error',
        kind: 'save',
        subject: { kind: 'note', path: NOTE },
      }),
    ]);
    expect(activity.reports[0]?.message).toMatch(/^Could not file the note — Call Mara\./);
  });
});
