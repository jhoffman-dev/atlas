// @vitest-environment jsdom
/**
 * Verification of PR #525: a filter whose choice has gone is "dropped" — but
 * only in what the page derives; the choice kept by the page is still the
 * gone one. When the value is offered again (a highlight recoloured back, a
 * tag put back, a note restored by a sync), the filter switches itself back
 * on with no action of the user's, and the list narrows under them.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  createVaultPath,
  highlightChoices,
  NO_HIGHLIGHT_FILTER,
  type HighlightEntry,
} from '@dfai/domain';
import { useHighlightsPage } from './use-research-pages.ts';

const NOW = Date.UTC(2026, 9, 22);

const highlight = (id: string, color: string): HighlightEntry => ({
  path: createVaultPath('Library/Ledger.md'),
  source: 'Ledger',
  modified: NOW,
  index: 0,
  id,
  kind: 'pdf',
  quote: id,
  comment: '',
  mark: 'highlight',
  color,
  page: null,
  location: null,
  tags: [],
});

const highlightsRead = (entries: HighlightEntry[]) => ({
  kind: 'ready' as const,
  entries,
  choices: highlightChoices(entries),
});

describe('a research filter dropped because its choice had gone', () => {
  it('stays off when the choice is offered again', () => {
    let read = highlightsRead([highlight('g1', 'green'), highlight('b1', 'blue')]);
    const { result, rerender } = renderHook(() => useHighlightsPage(read, () => NOW));
    act(() => result.current.onFilter({ ...NO_HIGHLIGHT_FILTER, colors: ['green'] }));

    // The only green highlight is recoloured blue: the green chip goes, the filter is dropped.
    read = highlightsRead([highlight('g1', 'blue'), highlight('b1', 'blue')]);
    rerender();
    expect(result.current.filter.colors).toEqual([]);

    // Later another highlight is made green: nothing the user did turns the filter on.
    read = highlightsRead([
      highlight('g1', 'blue'),
      highlight('b1', 'blue'),
      highlight('n1', 'green'),
    ]);
    rerender();
    expect(result.current.filter.colors).toEqual([]);
  });
});
