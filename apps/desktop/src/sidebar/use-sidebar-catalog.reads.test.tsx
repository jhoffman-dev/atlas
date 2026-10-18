// @vitest-environment jsdom
/**
 * The sidebar's catalogue is read again for what changed it, not for every
 * move of the index (#293): an autosave or a tick in a note outside `.atlas`
 * walked `.atlas` and read every note in it again.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ObjectType } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { queryWrapper } from '../reads/query-wrapper.tsx';
import { useSidebarCatalog } from './use-sidebar-catalog.ts';

const BOARD = '.atlas/views/Board.md';
const BOARD_NOTE = ['---', 'atlas: view', 'type: task', '---', '', '# Board', ''].join('\n');
const TYPES: readonly ObjectType[] = [];
const NO_NOTES: readonly string[] = [];

function countingVault() {
  const listed = vi.fn(async (folder: string) =>
    folder === '.atlas'
      ? [{ kind: 'directory' as const, name: 'views', path: '.atlas/views' }]
      : folder === '.atlas/views'
        ? [{ kind: 'file' as const, name: 'Board.md', path: BOARD }]
        : [],
  );
  const read = vi.fn(async (paths: readonly string[]) =>
    paths.includes(BOARD)
      ? [{ path: BOARD, text: BOARD_NOTE, modified: 1, size: BOARD_NOTE.length }]
      : [],
  );
  const fs = fakeVaultFs({
    listDirectory: listed as never,
    readNotes: read,
  });
  const index = fakeIndexPort({
    query: async () => ({ columns: [], rows: [], truncated: false }),
  });
  return { fs, index, listed, read };
}

const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) await act(async () => {});
};

describe('useSidebarCatalog: what is read again', () => {
  it('does not walk .atlas again when the index moves for a note outside it', async () => {
    const { fs, index, listed, read } = countingVault();
    const { wrapper } = queryWrapper();
    const hook = renderHook(
      ({ changeKey }: { changeKey: string }) =>
        useSidebarCatalog({
          fs,
          markdown: remarkMarkdown,
          index,
          types: TYPES,
          notePaths: NO_NOTES,
          vaultKey: 'v',
          changeKey,
        }),
      { wrapper, initialProps: { changeKey: 'revision 1' } },
    );
    await waitFor(() =>
      expect(hook.result.current.catalog.views.map((view) => view.path)).toEqual([BOARD]),
    );
    await settle();
    const [walks, reads] = [listed.mock.calls.length, read.mock.calls.length];

    hook.rerender({ changeKey: 'revision 2' });
    await settle();

    expect(listed.mock.calls.length - walks).toBe(0);
    expect(read.mock.calls.length - reads).toBe(0);
  });
});
