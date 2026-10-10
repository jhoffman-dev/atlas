// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { fakeVaultFs, recordingActivity } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import type { OpenEditors } from '../panes/open-editors.ts';
import { useChangeProperties } from './use-view-writes.ts';

/**
 * The one write behind a view's gestures and a dashboard's edits — a cell, a
 * card moved, a widget placed — and where it gives up.
 */

const NOTE = 'Tasks/Call Mara.md';
const TEXT = ['---', 'type: task', 'status: todo', '---', '', '# Call Mara', ''].join('\n');
const NO_PANE: OpenEditors = {
  register: () => {},
  setPropertiesIfOpen: async () => false,
  savePane: () => {},
  reloadOthers: () => {},
};

function changing({ refuse }: { refuse: string | null }) {
  const activity = recordingActivity();
  const fs = fakeVaultFs({
    readTextFile: async () => ({ text: TEXT, modified: 1 }),
    writeTextFile: async () => {
      if (refuse !== null) throw new Error(refuse);
      return 2;
    },
  });
  const onChanged = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() =>
    useChangeProperties({
      editors: NO_PANE,
      fs,
      markdown: remarkMarkdown,
      activity,
      onChanged,
      onError,
    }),
  );
  const change = () => act(() => hook.result.current({ path: NOTE, values: { status: 'done' } }));
  return { activity, onChanged, onError, change };
}

describe('useChangeProperties and the Activity log', () => {
  it('records a write the view gives up on once, naming the note', async () => {
    const { activity, onError, change } = changing({ refuse: 'The disk is full.' });
    change();
    await waitFor(() => expect(onError).toHaveBeenCalledWith('The disk is full.'));
    expect(activity.reports).toEqual([
      {
        level: 'error',
        kind: 'save',
        message: 'Could not save an edit — Call Mara. The disk is full.',
        subject: { kind: 'note', path: NOTE },
      },
    ]);
  });

  it('records nothing for a write that lands', async () => {
    const { activity, onChanged, change } = changing({ refuse: null });
    change();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(activity.reports).toEqual([]);
  });
});
