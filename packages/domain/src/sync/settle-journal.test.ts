import { describe, expect, it } from 'vitest';
import type { GitConflict } from './git-status.ts';
import {
  EMPTY_JOURNAL,
  journalEntryFor,
  journalText,
  parseJournal,
  thisMacsFileAfterConflict,
  withUnreported,
  type JournalFile,
  type SettleJournal,
} from './settle-journal.ts';

const HASH = 'a'.repeat(40);
const OTHER_HASH = 'b'.repeat(40);

const file = (overrides: Partial<JournalFile> = {}): JournalFile => ({
  path: 'Ideas.md',
  merged: HASH,
  ours: HASH,
  theirs: OTHER_HASH,
  copy: null,
  ...overrides,
});

const journal = (overrides: Partial<SettleJournal> = {}): SettleJournal => ({
  mergeHead: HASH,
  files: [file()],
  unreported: [],
  ...overrides,
});

const conflictOf = (overrides: Partial<GitConflict> = {}): GitConflict => ({
  path: 'Ideas.md',
  code: 'UU',
  base: null,
  ours: { mode: '100644', oid: HASH },
  theirs: { mode: '100644', oid: OTHER_HASH },
  ...overrides,
});

describe('journalText and parseJournal round trip', () => {
  it('reads back exactly what was written', () => {
    const written = journal();
    expect(parseJournal(journalText(written))).toEqual(written);
  });

  it('writes readable JSON ending in a newline, tagged with its version', () => {
    const text = journalText(journal());
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ version: 1, mergeHead: HASH });
  });
});

describe('parseJournal', () => {
  it('reads null as no journal', () => {
    expect(parseJournal(null)).toBeNull();
  });

  it('reads unparsable text as no journal, rather than throwing', () => {
    expect(parseJournal('{not json')).toBeNull();
  });

  it.each([['null'], ['"a string"'], ['42'], ['[]']])(
    'reads %s as no journal, since it is not an object of the right shape',
    (json) => {
      expect(parseJournal(json)).toBeNull();
    },
  );

  it('refuses a journal of another version', () => {
    const text = JSON.stringify({ version: 2, mergeHead: HASH, files: [] });
    expect(parseJournal(text)).toBeNull();
  });

  it('refuses a journal with no version at all', () => {
    const text = JSON.stringify({ mergeHead: HASH, files: [] });
    expect(parseJournal(text)).toBeNull();
  });

  it('refuses a journal whose mergeHead is missing or not a string', () => {
    expect(parseJournal(JSON.stringify({ version: 1, files: [] }))).toBeNull();
    expect(parseJournal(JSON.stringify({ version: 1, mergeHead: 7, files: [] }))).toBeNull();
  });

  it('refuses a journal whose files are not an array', () => {
    const text = JSON.stringify({ version: 1, mergeHead: HASH, files: {} });
    expect(parseJournal(text)).toBeNull();
  });

  it('refuses a file missing a required field', () => {
    const withoutPath: Record<string, unknown> = { ...file() };
    delete withoutPath['path'];
    const text = JSON.stringify({ version: 1, mergeHead: HASH, files: [withoutPath] });
    expect(parseJournal(text)).toBeNull();
  });

  it.each(['merged', 'ours', 'theirs'] as const)(
    'refuses a file whose %s blob is not null or a hex oid',
    (field) => {
      const text = JSON.stringify({
        version: 1,
        mergeHead: HASH,
        files: [file({ [field]: 'not-a-blob' })],
      });
      expect(parseJournal(text)).toBeNull();
    },
  );

  it('refuses a file whose copy is neither null nor a string', () => {
    const text = JSON.stringify({
      version: 1,
      mergeHead: HASH,
      files: [file({ copy: 7 as never })],
    });
    expect(parseJournal(text)).toBeNull();
  });

  it('accepts a blob field that is explicitly null', () => {
    const withNulls = file({ merged: null, ours: null, theirs: null });
    const text = JSON.stringify({ version: 1, mergeHead: HASH, files: [withNulls] });
    expect(parseJournal(text)).toEqual({ mergeHead: HASH, files: [withNulls], unreported: [] });
  });
});

describe('journalEntryFor', () => {
  it('finds the entry for this conflict of this merge', () => {
    const found = journalEntryFor({ journal: journal(), mergeHead: HASH, conflict: conflictOf() });
    expect(found).toEqual(file());
  });

  it('finds nothing without a journal', () => {
    expect(journalEntryFor({ journal: null, mergeHead: HASH, conflict: conflictOf() })).toBeNull();
  });

  it('finds nothing without a current merge head', () => {
    expect(
      journalEntryFor({ journal: journal(), mergeHead: null, conflict: conflictOf() }),
    ).toBeNull();
  });

  it('finds nothing when the journal is for a different merge', () => {
    const otherMerge = journal({ mergeHead: OTHER_HASH });
    expect(
      journalEntryFor({ journal: otherMerge, mergeHead: HASH, conflict: conflictOf() }),
    ).toBeNull();
  });

  it('finds nothing when the path matches but the blobs are of an older conflict', () => {
    const staleOurs = journal({ files: [file({ ours: 'c'.repeat(40) })] });
    expect(
      journalEntryFor({ journal: staleOurs, mergeHead: HASH, conflict: conflictOf() }),
    ).toBeNull();
    const staleTheirs = journal({ files: [file({ theirs: 'c'.repeat(40) })] });
    expect(
      journalEntryFor({ journal: staleTheirs, mergeHead: HASH, conflict: conflictOf() }),
    ).toBeNull();
  });

  it('reads a deleted side as null, matching a conflict with no file there', () => {
    const deletedOurs = journal({ files: [file({ ours: null })] });
    const conflict = conflictOf({ ours: null });
    expect(journalEntryFor({ journal: deletedOurs, mergeHead: HASH, conflict })).toEqual(
      deletedOurs.files[0],
    );
  });
});

describe('thisMacsFileAfterConflict', () => {
  it('restores this Mac’s side when the file is gone', () => {
    expect(thisMacsFileAfterConflict({ current: null, merged: HASH, ours: HASH })).toBe('ours');
    expect(thisMacsFileAfterConflict({ current: null, merged: null, ours: HASH })).toBe('ours');
  });

  it('writes this Mac’s side over the file, when it still holds exactly what the merge wrote', () => {
    const merged = HASH;
    expect(thisMacsFileAfterConflict({ current: merged, merged, ours: OTHER_HASH })).toBe('ours');
  });

  it('leaves the file as it is when it was edited since the merge wrote it', () => {
    expect(
      thisMacsFileAfterConflict({ current: 'c'.repeat(40), merged: HASH, ours: OTHER_HASH }),
    ).toBe('as-is');
  });

  it('leaves the file as it is when the merge wrote exactly this Mac’s own side', () => {
    // Nothing to restore over: the file already is this Mac's side.
    expect(thisMacsFileAfterConflict({ current: HASH, merged: HASH, ours: HASH })).toBe('as-is');
  });

  it('without a journal, keeps the file when it still is this Mac’s side', () => {
    expect(thisMacsFileAfterConflict({ current: HASH, merged: null, ours: HASH })).toBe('as-is');
  });

  it('without a journal, restores this Mac’s side when the file differs from it', () => {
    expect(thisMacsFileAfterConflict({ current: OTHER_HASH, merged: null, ours: HASH })).toBe(
      'ours',
    );
  });
});

describe('the copies a journal holds to report (review A29-01)', () => {
  const copy = {
    path: 'Ideas.md',
    copy: 'Ideas (conflict from Laptop).md',
    whose: 'theirs' as const,
  };

  it('reads back the copies still to report, and a journal with no merge yet', () => {
    const written = journal({ mergeHead: null, files: [], unreported: [copy] });
    expect(parseJournal(journalText(written))).toEqual(written);
  });

  it('reads a journal from before copies were kept as holding none', () => {
    const text = JSON.stringify({ version: 1, mergeHead: HASH, files: [] });
    expect(parseJournal(text)?.unreported).toEqual([]);
  });

  it.each([
    ['not a list', 'x'],
    ['a copy without its name', [{ path: 'a.md', whose: 'theirs' }]],
    ['a copy of nobody', [{ path: 'a.md', copy: 'b.md', whose: 'someone' }]],
    ['something else', [42]],
  ])('reads a journal whose copies are %s as none to trust', (_, unreported) => {
    const text = JSON.stringify({ version: 1, mergeHead: HASH, files: [], unreported });
    expect(parseJournal(text)).toBeNull();
  });

  it('refuses a merge head that is neither a commit nor none', () => {
    const text = JSON.stringify({ version: 1, mergeHead: 42, files: [] });
    expect(parseJournal(text)).toBeNull();
  });

  it('adds each copy once, keeping those already there', () => {
    const other = { path: 'b.md', copy: 'b (conflict from Laptop).md', whose: 'ours' as const };
    const once = withUnreported(EMPTY_JOURNAL, [copy]);
    expect(withUnreported(once, [copy, other]).unreported).toEqual([copy, other]);
    expect(EMPTY_JOURNAL.unreported).toEqual([]);
  });

  it('finds no entry in a journal with no merge yet', () => {
    const noted = journal({ mergeHead: null });
    expect(journalEntryFor({ journal: noted, mergeHead: HASH, conflict: conflictOf() })).toBeNull();
  });
});
