import { describe, expect, it } from 'vitest';
import { facetsChangedBetween, type FacetRow } from './index-facets.ts';

const title = (path: string, what: string): FacetRow => ({
  facet: 'graph',
  path,
  part: 'title',
  what,
  at: null,
  value: null,
});
const link = (path: string, to: string): FacetRow => ({
  facet: 'graph',
  path,
  part: 'link',
  what: to,
  at: null,
  value: null,
});
const tag = (path: string, key: string, at = 0): FacetRow => ({
  facet: 'tags',
  path,
  part: 'tag',
  what: key,
  at,
  value: key,
});

const changed = (before: FacetRow[] | null, after: FacetRow[] | null, paths = ['a.md']) => [
  ...facetsChangedBetween({ paths, before, after }),
];

describe('which facets a write changed', () => {
  it('is none when the note holds the same rows, whatever order they come in', () => {
    const rows = [title('a.md', 'A'), link('a.md', 'b.md'), link('a.md', 'c.md'), tag('a.md', 'x')];
    expect(changed(rows, [...rows].reverse())).toEqual([]);
  });

  it('is the graph for a new link, a lost one, or a new title, and not the tags', () => {
    const before = [title('a.md', 'A'), tag('a.md', 'x')];
    expect(changed(before, [...before, link('a.md', 'b.md')])).toEqual(['graph']);
    expect(changed([...before, link('a.md', 'b.md')], before)).toEqual(['graph']);
    expect(changed(before, [title('a.md', 'Renamed'), tag('a.md', 'x')])).toEqual(['graph']);
  });

  it('counts a link twice when it is written twice', () => {
    const once = [title('a.md', 'A'), link('a.md', 'b.md')];
    expect(changed(once, [...once, link('a.md', 'b.md')])).toEqual(['graph']);
  });

  it('is the tags for a tag added, dropped, respelled or moved, and not the graph', () => {
    const before = [title('a.md', 'A'), tag('a.md', 'x')];
    expect(changed(before, [...before, tag('a.md', 'y', 1)])).toEqual(['tags']);
    expect(changed(before, [title('a.md', 'A')])).toEqual(['tags']);
    expect(changed(before, [title('a.md', 'A'), { ...tag('a.md', 'x'), value: 'X' }])).toEqual([
      'tags',
    ]);
    expect(changed(before, [title('a.md', 'A'), tag('a.md', 'x', 3)])).toEqual(['tags']);
  });

  it('is each facet a note that was not there before holds rows of', () => {
    expect(changed([], [title('a.md', 'A')])).toEqual(['graph']);
    expect(changed([], [title('a.md', 'A'), tag('a.md', 'x')])).toEqual(['graph', 'tags']);
  });

  it('is every facet when either side is unknown', () => {
    const rows = [title('a.md', 'A')];
    expect(changed(null, rows)).toEqual(['graph', 'tags']);
    expect(changed(rows, null)).toEqual(['graph', 'tags']);
  });

  it('is every facet when the answer after the write is missing a note it wrote', () => {
    // A path the index could not be asked about answers nothing either side, which would look unchanged.
    expect(changed([], [], ['a.md'])).toEqual(['graph', 'tags']);
    const rows = [title('a.md', 'A')];
    expect(changed(rows, rows, ['a.md', 'b.md'])).toEqual(['graph', 'tags']);
  });
});
