import { describe, expect, it } from 'vitest';
import { caseCollisions, caseRenames, foldedPath } from './case-names.ts';
import type { GitEntry } from './git-listings.ts';

const entry = (path: string, oid: string, mode = '100644'): GitEntry => ({ mode, oid, path });
const map = (...entries: readonly GitEntry[]) => new Map(entries.map((e) => [e.path, e]));
const X = 'x'.repeat(40);
const Y = 'y'.repeat(40);

describe('foldedPath', () => {
  it('folds case and composes accents, so a Mac disk sees the same name once', () => {
    expect(foldedPath('Idea.md')).toBe(foldedPath('IDEA.md'));
    expect(foldedPath('Café.md'.normalize('NFC'))).toBe(foldedPath('Café.md'.normalize('NFD')));
  });

  it('leaves names that truly differ as different', () => {
    expect(foldedPath('Idea.md')).not.toBe(foldedPath('Ideas.md'));
  });
});

describe('caseRenames', () => {
  it('finds a note renamed only in case, from its tracked spelling to its spelling on disk', () => {
    const renames = caseRenames({
      tracked: ['idea.md'],
      untrackedExact: ['Idea.md'],
      untracked: [],
    });
    expect(renames).toEqual([{ from: 'idea.md', to: 'Idea.md' }]);
  });

  it('finds none on a disk that tells case apart, since nothing is folded away there', () => {
    // The disk-compared listing already shows the file, so it is not a rename: it is new.
    const renames = caseRenames({
      tracked: ['Idea.md'],
      untrackedExact: ['idea.md'],
      untracked: ['idea.md'],
    });
    expect(renames).toEqual([]);
  });

  it('ignores a nested repository’s own folder entry, even if its case matches a tracked path', () => {
    const renames = caseRenames({
      tracked: ['idea/'],
      untrackedExact: ['Idea/'],
      untracked: [],
    });
    expect(renames).toEqual([]);
  });

  it('leaves it be when two tracked spellings could both be the file', () => {
    const renames = caseRenames({
      tracked: ['Idea.md', 'IDEA.md'],
      untrackedExact: ['idea.md'],
      untracked: [],
    });
    expect(renames).toEqual([]);
  });

  it('finds nothing to rename when nothing is untracked', () => {
    expect(caseRenames({ tracked: ['Idea.md'], untrackedExact: [], untracked: [] })).toEqual([]);
  });
});

describe('caseCollisions', () => {
  it('moves this Mac’s path aside when both sides added fold-equal names', () => {
    const base = map();
    const ours = map(entry('Idea.md', X));
    const theirs = map(entry('idea.md', Y));
    expect(caseCollisions({ base, ours, theirs })).toEqual(['Idea.md']);
  });

  it('is not a collision when the other side only renamed its case and this Mac left the file alone', () => {
    const base = map(entry('idea.md', X));
    const ours = map(entry('idea.md', X)); // unchanged
    const theirs = map(entry('Idea.md', X)); // renamed in case only, same content
    expect(caseCollisions({ base, ours, theirs })).toEqual([]);
  });

  it('is a collision when this Mac edited the file while the other renamed its case', () => {
    const base = map(entry('idea.md', X));
    const ours = map(entry('idea.md', Y)); // edited
    const theirs = map(entry('Idea.md', X)); // renamed in case only
    expect(caseCollisions({ base, ours, theirs })).toEqual(['idea.md']);
  });

  it('folds composed and decomposed accents alike', () => {
    const composed = 'Café.md'.normalize('NFC');
    const decomposed = 'CAFÉ.md'.normalize('NFD');
    const base = map();
    const ours = map(entry(composed, X));
    const theirs = map(entry(decomposed, Y));
    expect(caseCollisions({ base, ours, theirs })).toEqual([composed]);
  });

  it('is not a collision when both sides kept the very same spelling', () => {
    const base = map(entry('Idea.md', X));
    const ours = map(entry('Idea.md', Y));
    const theirs = map(entry('Idea.md', X));
    expect(caseCollisions({ base, ours, theirs })).toEqual([]);
  });

  it('folds a folder’s case too, not only the file name', () => {
    const base = map();
    const ours = map(entry('Notes/Idea.md', X));
    const theirs = map(entry('notes/Idea.md', Y));
    expect(caseCollisions({ base, ours, theirs })).toEqual(['Notes/Idea.md']);
  });

  it('finds nothing when neither side added or renamed anything', () => {
    const base = map(entry('idea.md', X));
    const ours = map(entry('idea.md', X));
    const theirs = map(entry('idea.md', X));
    expect(caseCollisions({ base, ours, theirs })).toEqual([]);
  });
});
