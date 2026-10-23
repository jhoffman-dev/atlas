// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  EmbeddingError,
  fakeIndexPort,
  type SemanticHit,
  type SemanticQuery,
  type SemanticSearch,
} from '@dfai/application';
import { createOverlayStore } from '../overlay-store.ts';
import { useSearch } from './use-search.ts';

const hit = (path: string, block: string | null, text: string): SemanticHit => ({
  path,
  title: path.replace('.md', ''),
  text,
  heading: null,
  block,
  link: `[[${path}]]`,
  score: 0.5,
});

function semanticOf(hits: readonly SemanticHit[]) {
  const asked: SemanticQuery[] = [];
  const semantic: SemanticSearch = {
    search: async (query) => {
      asked.push(query);
      return { hits, progress: { done: 2, total: 5, failure: null } };
    },
  };
  return { asked, semantic };
}

describe('useSearch by meaning (P32-02)', () => {
  it('asks the vault by meaning once it is switched on, and shows each place once', async () => {
    let wordSearches = 0;
    const index = fakeIndexPort({
      search: async () => {
        wordSearches += 1;
        return [];
      },
    });
    const { asked, semantic } = semanticOf([
      hit('Standup.md', null, 'Pay day moves to Friday.'),
      hit('Standup.md', null, 'Payroll is late.'),
      hit('Standup.md', 'k3x9a1', 'Wages go up.'),
      hit('Garden.md', null, 'Bees.'),
    ]);
    const store = createOverlayStore();
    const { result } = renderHook(() => useSearch({ index, semantic, store }));

    act(() => result.current.setByMeaning(true));
    act(() => result.current.setQuery('when are wages paid?'));

    await waitFor(() => expect(result.current.hits).toHaveLength(3));
    expect(asked.at(-1)).toEqual({
      query: 'when are wages paid?',
      limit: 20,
      includeArchived: false,
    });
    expect(wordSearches).toBe(0);
    expect(result.current.hits).toEqual([
      { path: 'Standup.md', title: 'Standup', snippet: 'Pay day moves to Friday.' },
      { path: 'Standup.md', title: 'Standup', snippet: 'Wages go up.', block: 'k3x9a1' },
      { path: 'Garden.md', title: 'Garden', snippet: 'Bees.' },
    ]);
    expect(result.current.meaning).toEqual({
      progress: { done: 2, total: 5, failure: null },
      problem: null,
    });
  });

  it('searches by words again once it is switched off', async () => {
    let wordSearches = 0;
    const index = fakeIndexPort({
      search: async () => {
        wordSearches += 1;
        return [{ path: 'A.md', title: 'A', snippet: '<<pay>>' }];
      },
    });
    const store = createOverlayStore();
    const { semantic } = semanticOf([]);
    const { result } = renderHook(() => useSearch({ index, semantic, store }));
    act(() => result.current.setByMeaning(true));
    act(() => result.current.setQuery('pay'));
    act(() => result.current.setByMeaning(false));
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(wordSearches).toBeGreaterThan(0);
    expect(result.current.byMeaning).toBe(false);
    expect(result.current.meaning).toBeNull();
  });

  it('says why when the search by meaning cannot run', async () => {
    const semantic: SemanticSearch = {
      search: async () => {
        throw new EmbeddingError('the model could not be fetched: no network');
      },
    };
    const store = createOverlayStore();
    const index = fakeIndexPort();
    const { result } = renderHook(() => useSearch({ index, semantic, store }));
    act(() => result.current.setByMeaning(true));
    act(() => result.current.setQuery('pay'));
    await waitFor(() =>
      expect(result.current.meaning?.problem).toBe('the model could not be fetched: no network'),
    );
    expect(result.current.hits).toEqual([]);
  });

  it('is not offered, and searches by words, where the vault has no semantic search', async () => {
    let wordSearches = 0;
    const index = fakeIndexPort({
      search: async () => {
        wordSearches += 1;
        return [];
      },
    });
    const store = createOverlayStore();
    const { result } = renderHook(() => useSearch({ index, semantic: null, store }));
    act(() => result.current.setByMeaning(true));
    act(() => result.current.setQuery('pay'));
    await waitFor(() => expect(wordSearches).toBe(1));
    expect(result.current.byMeaning).toBe(false);
  });
});
