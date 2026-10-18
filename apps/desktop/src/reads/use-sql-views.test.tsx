// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
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
      initialProps: { types, ready: false },
    });
    expect(rebuildViews).not.toHaveBeenCalled();

    hook.rerender({ types, ready: true });
    expect(rebuildViews).toHaveBeenCalledTimes(1);

    // The same definitions, drawn again: nothing to rebuild.
    hook.rerender({ types, ready: true });
    expect(rebuildViews).toHaveBeenCalledTimes(1);

    const renamed = [{ ...book, label: 'Books' }];
    hook.rerender({ types: renamed, ready: true });
    expect(rebuildViews).toHaveBeenCalledTimes(2);

    // A rebuild of the index makes the database afresh, without its views.
    hook.rerender({ types: renamed, ready: false });
    expect(rebuildViews).toHaveBeenCalledTimes(2);
    hook.rerender({ types: renamed, ready: true });
    expect(rebuildViews).toHaveBeenCalledTimes(3);
  });

  it('are not built for a vault with no types', () => {
    const rebuildViews = vi.fn(async () => {});
    renderHook(() => useSqlViews({ index: { rebuildViews }, types: [], ready: true }));
    expect(rebuildViews).not.toHaveBeenCalled();
  });
});
