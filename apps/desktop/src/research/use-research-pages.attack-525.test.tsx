// @vitest-environment jsdom
/**
 * Attack tests for PR #525 (#507): a filter left pointing at a choice the
 * vault no longer has. The dropdown then reads "every one" (FilterSelect
 * shows a value no choice holds as such) while the list still filters by
 * the gone value, so the page shows nothing and choosing "every one" again
 * is choosing what is already selected. What the page filters by must be
 * what its controls say.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  createVaultPath,
  NO_HIGHLIGHT_FILTER,
  NO_LIBRARY_FILTER,
  type HighlightEntry,
  type LibraryEntry,
} from '@dfai/domain';
import { useHighlightsPage, useLibraryPage } from './use-research-pages.ts';

const NOW = Date.UTC(2026, 9, 22);

const source = (name: string, rest: Partial<LibraryEntry> = {}): LibraryEntry => ({
  path: createVaultPath(`Library/${name}.md`),
  title: name,
  author: null,
  kind: 'pdf',
  highlights: 0,
  modified: 0,
  tags: [],
  projects: [],
  cover: null,
  ...rest,
});

const highlight = (name: string, id: string, color = 'yellow'): HighlightEntry => ({
  path: createVaultPath(`Library/${name}.md`),
  source: name,
  modified: NOW,
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

type Shown = { kind: string; shown?: readonly unknown[] };
const count = (state: Shown) => (state.kind === 'ready' ? (state.shown?.length ?? 0) : -1);

describe('a research filter whose choice has gone (attack #525)', () => {
  it('the Library shows every source once the tag it was filtered by is on none', () => {
    let read = {
      kind: 'ready' as const,
      entries: [source('Meditations', { tags: ['stoic'] }), source('Dune')],
    };
    const { result, rerender } = renderHook(() => useLibraryPage(read));
    act(() => result.current.onFilter({ ...NO_LIBRARY_FILTER, tag: 'stoic' }));
    expect(count(result.current.state)).toBe(1);

    // The tag is taken off the note elsewhere; the index answers again.
    read = { kind: 'ready', entries: [source('Meditations'), source('Dune')] };
    rerender();
    expect(result.current.choices.tags).toEqual([]);
    expect(count(result.current.state)).toBe(2);
  });

  it('All highlights shows every highlight once the source it was filtered by is deleted', () => {
    let read = {
      kind: 'ready' as const,
      entries: [highlight('Gone', 'g1'), highlight('Kept', 'k1')],
    };
    const { result, rerender } = renderHook(() => useHighlightsPage(read, () => NOW));
    act(() =>
      result.current.onFilter({
        ...NO_HIGHLIGHT_FILTER,
        source: createVaultPath('Library/Gone.md'),
      }),
    );
    expect(count(result.current.state)).toBe(1);

    read = { kind: 'ready', entries: [highlight('Kept', 'k1')] };
    rerender();
    expect(result.current.choices.sources.map((each) => each.value)).toEqual(['Library/Kept.md']);
    expect(count(result.current.state)).toBe(1);
  });

  it('a colour chip that is no longer offered no longer filters (it cannot be pressed off)', () => {
    let read = {
      kind: 'ready' as const,
      entries: [highlight('A', 'green1', 'green'), highlight('A', 'blue1', 'blue')],
    };
    const { result, rerender } = renderHook(() => useHighlightsPage(read, () => NOW));
    act(() => result.current.onFilter({ ...NO_HIGHLIGHT_FILTER, colors: ['green'] }));
    expect(count(result.current.state)).toBe(1);

    // The only green highlight is recoloured blue in its note.
    read = {
      kind: 'ready',
      entries: [highlight('A', 'green1', 'blue'), highlight('A', 'blue1', 'blue')],
    };
    rerender();
    expect(result.current.choices.colors.map((each) => each.value)).toEqual(['blue']);
    expect(count(result.current.state)).toBe(2);
  });
});
