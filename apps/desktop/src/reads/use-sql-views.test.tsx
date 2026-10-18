// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import type { DefinedType } from '@atlas/application';
import { useSqlViews } from './use-sql-views.ts';

const book: DefinedType = {
  name: 'book',
  label: 'Book',
  properties: [],
  path: createVaultPath('.atlas/types/book.md'),
};

describe('the SQL views behind the types', () => {
  it('are built once the index is ready, and again only for new definitions or a new build', () => {
    const rebuildViews = vi.fn(async () => {});
    const types = [book];
    // Held across renders, as the window holds its index.
    const index = { rebuildViews };
    const hook = renderHook((props) => useSqlViews({ index, ...props }), {
      initialProps: { types, ready: false, revision: 1 },
    });
    expect(rebuildViews).not.toHaveBeenCalled();

    hook.rerender({ types, ready: true, revision: 1 });
    expect(rebuildViews).toHaveBeenCalledTimes(1);

    // The same definitions, drawn again: nothing to rebuild.
    hook.rerender({ types, ready: true, revision: 1 });
    expect(rebuildViews).toHaveBeenCalledTimes(1);

    const renamed = [{ ...book, label: 'Books' }];
    hook.rerender({ types: renamed, ready: true, revision: 1 });
    expect(rebuildViews).toHaveBeenCalledTimes(2);

    // A rebuild of the index makes the database afresh, without its views.
    hook.rerender({ types: renamed, ready: false, revision: 1 });
    expect(rebuildViews).toHaveBeenCalledTimes(2);
    hook.rerender({ types: renamed, ready: true, revision: 1 });
    expect(rebuildViews).toHaveBeenCalledTimes(3);
  });

  it('are not built for a vault with no types', () => {
    const rebuildViews = vi.fn(async () => {});
    renderHook(() => useSqlViews({ index: { rebuildViews }, types: [], ready: true, revision: 1 }));
    expect(rebuildViews).not.toHaveBeenCalled();
  });

  it('tries a failed rebuild again when the index next has news, and only then', async () => {
    const rebuildViews = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValue(undefined);
    const index = { rebuildViews };
    const types = [book];
    const hook = renderHook((props) => useSqlViews({ index, types, ready: true, ...props }), {
      initialProps: { revision: 1 },
    });
    await act(async () => {});
    expect(rebuildViews).toHaveBeenCalledTimes(1);

    hook.rerender({ revision: 2 });
    await act(async () => {});
    expect(rebuildViews).toHaveBeenCalledTimes(2);

    // It worked: more news is nothing to rebuild for.
    hook.rerender({ revision: 3 });
    expect(rebuildViews).toHaveBeenCalledTimes(2);
  });
});
