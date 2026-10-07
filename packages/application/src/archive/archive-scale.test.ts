/**
 * U-22's measure: a vault with 5,000 archived notes opens no slower. The host
 * still lists them (their links resolve and search-with-archived needs them
 * indexed), so what is asserted is that opening does no work per archived
 * note beyond comparing what the host listed with what the index knows —
 * none is read, none is written to the index — once they are indexed.
 */
import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { refreshIndex } from '../index/refresh-index.ts';

const ARCHIVED = 5000;

describe('a vault with 5,000 archived notes', () => {
  it('reads none of them when the vault opens and nothing has changed', async () => {
    const listing = [
      { path: 'Live.md', modified: 1, size: 1 },
      ...Array.from({ length: ARCHIVED }, (_, n) => ({
        path: `Archive/Old/${n}.md`,
        modified: 1,
        size: 1,
      })),
    ];
    const readNotes = vi.fn(async () => []);
    const put = vi.fn(async () => {});
    const fs = fakeVaultFs({
      listNotes: async () =>
        listing.map((note) => ({
          ...note,
          name: note.path.split('/').at(-1) ?? note.path,
          path: createVaultPath(note.path),
        })),
      readNotes,
    });
    const index = fakeIndexPort({ manifest: async () => listing, put });

    const refreshed = await refreshIndex({ fs, index, markdown: fakeMarkdown() });

    expect(refreshed).toEqual({ indexed: 0, removed: 0, unchanged: ARCHIVED + 1 });
    expect(readNotes).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
