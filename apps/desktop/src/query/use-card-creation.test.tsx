// @vitest-environment jsdom
/**
 * A card added in a board's column and lane is given both values as their
 * fields are written — a number as a number, a tick as a tick (issue #6).
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { parseObjectType } from '@atlas/domain';
import { fakeVaultFs } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useCardCreation } from './use-card-creation.ts';

const TASK = parseObjectType({
  name: 'task',
  properties: { phase: 'number', flagged: 'checkbox', status: 'select' },
});

function creation({ groupBy, subGroupBy }: { groupBy: string; subGroupBy: string | null }) {
  const created: string[] = [];
  const fs = fakeVaultFs({
    createNote: async ({ contents }) => {
      created.push(contents);
    },
  });
  const hook = renderHook(() =>
    useCardCreation({
      fs,
      markdown: remarkMarkdown,
      query: { type: 'task', columns: [], filters: [], sorts: [], limit: 50 },
      type: TASK,
      groupBy,
      subGroupBy,
      dateKey: null,
      groupOptions: [],
      notePaths: [],
      onChanged: () => {},
      onError: () => {},
    }),
  );
  return { hook, created };
}

describe('a card added in a column and a lane', () => {
  it('writes a number column’s value as a number and a ticked lane as a tick', async () => {
    const { hook, created } = creation({ groupBy: 'phase', subGroupBy: 'flagged' });
    act(() => hook.result.current.addCard({ value: '3', lane: 'true', name: 'Ship' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatch(/^phase: 3$/m);
    expect(created[0]).toMatch(/^flagged: true$/m);
  });

  it('gives a card added to the unticked lane no box at all', async () => {
    const { hook, created } = creation({ groupBy: 'status', subGroupBy: 'flagged' });
    act(() => hook.result.current.addCard({ value: 'doing', lane: 'false', name: 'Ship' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatch(/^status: doing$/m);
    expect(created[0]).not.toMatch(/flagged/);
  });
});
