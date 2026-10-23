import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import type { SearchScope } from './ports.ts';
import { searchNotes } from './search-notes.ts';

describe('searchNotes with highlights (#507)', () => {
  it('asks the index for the highlights only when told to, beside the prefix it skips', async () => {
    const scopes: (SearchScope | undefined)[] = [];
    const index = fakeIndexPort({
      search: async (_query, _limit, scope) => {
        scopes.push(scope);
        return [];
      },
    });
    await searchNotes({ index, query: '"x"', limit: 20, includeArchived: false, highlights: true });
    await searchNotes({ index, query: '"x"', limit: 20, includeArchived: true, highlights: true });
    await searchNotes({ index, query: '"x"', limit: 20, includeArchived: false });
    expect(scopes).toEqual([
      { skipPrefix: 'archive/', highlights: true },
      { highlights: true },
      { skipPrefix: 'archive/' },
    ]);
  });

  it("keeps a highlight's block on its hit, and drops a template's highlight as it drops the template", async () => {
    const index = fakeIndexPort({
      search: async () => [
        { path: 'Library/Art.md', title: 'Art', snippet: 'a' },
        { path: 'Library/Art.md', title: 'Art', snippet: '<<war>>', block: 'k3x9q2' },
        { path: '.atlas/templates/Book.md', title: 'Book', snippet: 'b', block: 'zzzzzz' },
      ],
    });
    const hits = await searchNotes({
      index,
      query: '"war"',
      limit: 20,
      includeArchived: false,
      highlights: true,
    });
    expect(hits).toEqual([
      { path: 'Library/Art.md', title: 'Art', snippet: 'a' },
      { path: 'Library/Art.md', title: 'Art', snippet: '<<war>>', block: 'k3x9q2' },
    ]);
  });
});
