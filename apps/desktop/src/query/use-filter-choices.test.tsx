// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { noteNames, type ObjectType } from '@atlas/domain';
import { fakeIndexPort, type IndexPort } from '@atlas/application';
import { useFilterChoices } from './use-filter-choices.ts';

/* #212: the Filter control's choices for each property of a view's type. */

const TASK: ObjectType = {
  name: 'task',
  label: 'Task',
  properties: [
    {
      key: 'status',
      kind: 'select',
      label: 'Status',
      required: false,
      options: ['next-action', 'archive'],
      target: null,
      many: false,
    },
    {
      key: 'project',
      kind: 'relation',
      label: 'Project',
      required: false,
      options: [],
      target: 'project',
      many: false,
    },
  ],
};

const NAMES = noteNames(null);

const projects = (titles: readonly string[]): IndexPort =>
  fakeIndexPort({
    notesOfType: async () => titles.map((title) => ({ path: `projects/${title}.md`, title })),
  });

describe('useFilterChoices', () => {
  it('offers a select’s options at once, and a relation’s notes once the index answers', async () => {
    const { result } = renderHook(() =>
      useFilterChoices({
        type: TASK,
        index: projects(['Larkspur launch']),
        indexKey: '1',
        names: NAMES,
      }),
    );

    expect(result.current['status']).toEqual([
      { value: 'next-action', label: 'Next Action' },
      { value: 'archive', label: 'Archive' },
    ]);
    await waitFor(() =>
      expect(result.current['project']).toEqual([
        { value: '[[projects/Larkspur launch]]', label: 'Larkspur launch' },
      ]),
    );
  });

  it('reads the notes again when the index changes', async () => {
    let titles = ['Larkspur launch'];
    const index = fakeIndexPort({
      notesOfType: async () => titles.map((title) => ({ path: `projects/${title}.md`, title })),
    });
    const { result, rerender } = renderHook(
      ({ indexKey }) => useFilterChoices({ type: TASK, index, indexKey, names: NAMES }),
      { initialProps: { indexKey: '1' } },
    );
    await waitFor(() => expect(result.current['project']).toHaveLength(1));

    titles = ['Larkspur launch', 'Quill audit'];
    rerender({ indexKey: '2' });
    await waitFor(() => expect(result.current['project']).toHaveLength(2));
  });

  it('still offers the options when the index cannot answer', async () => {
    let asked = false;
    const { result } = renderHook(() =>
      useFilterChoices({
        type: TASK,
        index: fakeIndexPort({
          notesOfType: () => {
            asked = true;
            return Promise.reject(new Error('index not ready'));
          },
        }),
        indexKey: '1',
        names: NAMES,
      }),
    );
    await waitFor(() => expect(asked).toBe(true));
    expect(result.current['project']).toEqual([]);
    expect(result.current['status']).toHaveLength(2);
  });

  it('offers nothing without a type', () => {
    const { result } = renderHook(() =>
      useFilterChoices({ type: null, index: projects([]), indexKey: '1', names: NAMES }),
    );
    expect(result.current).toEqual({});
  });
});
