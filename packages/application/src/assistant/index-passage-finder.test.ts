import { describe, expect, it } from 'vitest';
import type { SearchHit, SearchScope } from '../index/ports.ts';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { indexPassageFinder, PASSAGE_SEARCH_CAP } from './index-passage-finder.ts';

/** An index whose search ranks `ranked` in order, recording each limit and scope it was asked with. */
function rankedIndex(ranked: readonly string[]) {
  const asked: { query: string; limit: number; scope: SearchScope | undefined }[] = [];
  const index = fakeIndexPort({
    search: async (query, limit, scope) => {
      asked.push({ query, limit, scope });
      return ranked.slice(0, limit).map((path): SearchHit => ({ path, title: path, snippet: '' }));
    },
  });
  return { finder: indexPassageFinder(index), asked };
}

const noise = (count: number) => Array.from({ length: count }, (_, at) => `Notes/${at}.md`);

describe('indexPassageFinder', () => {
  it('answers the notes asked about that search ranks, best first, naming no block', async () => {
    const { finder, asked } = rankedIndex(['Notes/a.md', 'Meetings/B.md', 'Meetings/A.md']);
    const found = await finder.find({
      about: 'bank file',
      within: ['Meetings/A.md', 'Meetings/B.md', 'Meetings/C.md'],
      limit: 10,
    });
    expect(found.passages).toEqual([
      { path: 'Meetings/B.md', blocks: null },
      { path: 'Meetings/A.md', blocks: null },
    ]);
    // The hits ended below the first ask: C holds nothing about it.
    expect(found.complete).toBe(true);
    // Searched as the palette searches, the Archive left out.
    expect(asked).toEqual([
      { query: '"bank" "file"*', limit: 100, scope: { skipPrefix: 'archive/' } },
    ]);
  });

  it('asks for more hits, doubling, until enough of the notes are found', async () => {
    const { finder, asked } = rankedIndex([...noise(300), 'Meetings/A.md']);
    const found = await finder.find({ about: 'bank', within: ['Meetings/A.md'], limit: 5 });
    expect(found.passages.map((passage) => passage.path)).toEqual(['Meetings/A.md']);
    expect(found.complete).toBe(true);
    expect(asked.map((one) => one.limit)).toEqual([100, 200, 400]);
  });

  it('stops at its cap, finding nothing ranked below it, and says it did not look everywhere', async () => {
    const { finder, asked } = rankedIndex([...noise(PASSAGE_SEARCH_CAP + 10), 'Meetings/A.md']);
    const found = await finder.find({ about: 'bank', within: ['Meetings/A.md'], limit: 5 });
    expect(found.passages).toEqual([]);
    expect(found.complete).toBe(false);
    expect(asked.at(-1)?.limit).toBe(PASSAGE_SEARCH_CAP);
  });

  it('is complete when the hits ended exactly at the cap with nothing left unasked', async () => {
    const { finder } = rankedIndex(noise(PASSAGE_SEARCH_CAP - 1));
    const found = await finder.find({ about: 'bank', within: ['Meetings/A.md'], limit: 5 });
    expect(found.complete).toBe(true);
  });

  it('keeps to the limit', async () => {
    const { finder } = rankedIndex(['Meetings/A.md', 'Meetings/B.md', 'Meetings/C.md']);
    const found = await finder.find({
      about: 'bank',
      within: ['Meetings/A.md', 'Meetings/B.md', 'Meetings/C.md'],
      limit: 2,
    });
    expect(found.passages.map((passage) => passage.path)).toEqual([
      'Meetings/A.md',
      'Meetings/B.md',
    ]);
    // A third matched and was not returned: not every match is in the answer.
    expect(found.complete).toBe(false);
  });

  it('asks nothing of the index for punctuation alone, or for no notes', async () => {
    const { finder, asked } = rankedIndex(['Meetings/A.md']);
    const none = { passages: [], complete: true };
    expect(await finder.find({ about: '"" ', within: ['Meetings/A.md'], limit: 5 })).toEqual(none);
    expect(await finder.find({ about: 'bank', within: [], limit: 5 })).toEqual(none);
    expect(asked).toEqual([]);
  });
});
