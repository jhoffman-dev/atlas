import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { rankNoteSuggestions } from './note-suggestions.ts';

const notes = (...paths: string[]) => paths.map(createVaultPath);
const targets = (query: string, paths: string[], limit?: number) =>
  rankNoteSuggestions(query, notes(...paths), {
    ...(limit !== undefined && { limit }),
  }).map((s) => s.target);

describe('rankNoteSuggestions', () => {
  it('offers everything when nothing has been typed yet', () => {
    expect(targets('', ['a.md', 'b.md'])).toEqual(['a.md'.replace('.md', ''), 'b']);
  });

  it('drops notes that do not match', () => {
    expect(targets('week', ['Weekly review.md', 'Today.md'])).toEqual(['Weekly review']);
  });

  it('is case-insensitive', () => {
    expect(targets('WEEK', ['Weekly review.md'])).toEqual(['Weekly review']);
  });

  it('ranks an exact name above a prefix match', () => {
    expect(targets('note', ['Notebook.md', 'Note.md'])).toEqual(['Note', 'Notebook']);
  });

  it('ranks a prefix match above a substring match', () => {
    expect(targets('rev', ['Weekly review.md', 'Review.md'])).toEqual(['Review', 'Weekly review']);
  });

  it('prefers the note closest to the root when scores tie', () => {
    expect(
      rankNoteSuggestions('today', notes('a/b/Today.md', 'Today.md')).map((s) => s.path),
    ).toEqual(['Today.md', 'a/b/Today.md']);
  });

  it('orders equal candidates alphabetically, so the list is stable', () => {
    const paths = ['b/Note.md', 'a/Note.md'];
    expect(rankNoteSuggestions('note', notes(...paths)).map((s) => s.path)).toEqual([
      'a/Note.md',
      'b/Note.md',
    ]);
    expect(rankNoteSuggestions('note', notes(...paths.reverse())).map((s) => s.path)).toEqual([
      'a/Note.md',
      'b/Note.md',
    ]);
  });

  it('offers the name a link would use, without the extension', () => {
    expect(rankNoteSuggestions('week', notes('Notes/Weekly review.md'))).toEqual([
      { path: 'Notes/Weekly review.md', target: 'Weekly review' },
    ]);
  });

  it('writes the path when the name alone would open another note of that name (A20-05)', () => {
    expect(targets('note', ['a/Note.md', 'b/Note.md'])).toEqual(['Note', 'b/Note']);
  });

  it('resolves against every linkable note, not only the ones offered (A20-05)', () => {
    const offered = rankNoteSuggestions('meet', notes('Notes/Meeting.md'), {
      linkable: notes('Archive/Meeting.md', 'Notes/Meeting.md'),
    });
    expect(offered).toEqual([{ path: 'Notes/Meeting.md', target: 'Notes/Meeting' }]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 50 }, (_, i) => `note-${String(i).padStart(2, '0')}.md`);
    expect(targets('note', many, 5)).toHaveLength(5);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(targets('  week  ', ['Weekly review.md'])).toEqual(['Weekly review']);
  });

  it('returns nothing for an empty vault', () => {
    expect(rankNoteSuggestions('anything', [])).toEqual([]);
  });
});
