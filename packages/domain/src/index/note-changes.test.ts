import { describe, expect, it } from 'vitest';
import {
  arrivedPaths,
  noteChangesBetween,
  noteVersionKey,
  versionsAfter,
  type NoteChange,
  type NoteVersion,
} from './note-changes.ts';

const meeting = (digest: string): NoteVersion => ({ type: 'meeting', digest });
const versions = (entries: Record<string, NoteVersion>) => new Map(Object.entries(entries));

describe('noteChangesBetween', () => {
  it('finds nothing when every note reads as it did', () => {
    const same = versions({ 'Standup.md': meeting('aa'), 'Idea.md': { type: null, digest: 'bb' } });
    expect(noteChangesBetween(same, new Map(same))).toEqual([]);
  });

  it('says a note that was not there before was added, with its type and digest', () => {
    expect(
      noteChangesBetween(new Map(), versions({ 'meetings/Kickoff.md': meeting('aa') })),
    ).toEqual([{ kind: 'added', path: 'meetings/Kickoff.md', type: 'meeting', digest: 'aa' }]);
  });

  it('says a note whose text is different changed, as it is now', () => {
    expect(
      noteChangesBetween(
        versions({ 'Kickoff.md': { type: null, digest: 'aa' } }),
        versions({ 'Kickoff.md': meeting('bb') }),
      ),
    ).toEqual([{ kind: 'changed', path: 'Kickoff.md', type: 'meeting', digest: 'bb' }]);
  });

  it('says a note that has gone was removed, as it last was', () => {
    expect(noteChangesBetween(versions({ 'Kickoff.md': meeting('aa') }), new Map())).toEqual([
      { kind: 'removed', path: 'Kickoff.md', type: 'meeting', digest: 'aa' },
    ]);
  });

  it('reports a rename as the old path removed and the new one added, with one digest', () => {
    expect(
      noteChangesBetween(
        versions({ 'Kickoff.md': meeting('aa') }),
        versions({ 'Kickoff with Larkspur.md': meeting('aa') }),
      ),
    ).toEqual([
      { kind: 'added', path: 'Kickoff with Larkspur.md', type: 'meeting', digest: 'aa' },
      { kind: 'removed', path: 'Kickoff.md', type: 'meeting', digest: 'aa' },
    ]);
  });

  it('carries only the version, whatever else the entry it came from holds', () => {
    const entry = { type: 'meeting', digest: 'aa', modified: 7, size: 3 };
    expect(noteChangesBetween(new Map(), new Map([['Kickoff.md', entry]]))).toEqual([
      { kind: 'added', path: 'Kickoff.md', type: 'meeting', digest: 'aa' },
    ]);
  });
});

describe('versionsAfter', () => {
  it('adds, replaces and forgets notes as the changes say, leaving the rest', () => {
    const before = versions({
      'Kept.md': meeting('aa'),
      'Edited.md': meeting('bb'),
      'Gone.md': meeting('cc'),
    });
    const after = versionsAfter(before, [
      { kind: 'added', path: 'New.md', type: null, digest: 'dd' },
      { kind: 'changed', path: 'Edited.md', type: 'task', digest: 'ee' },
      { kind: 'removed', path: 'Gone.md', type: 'meeting', digest: 'cc' },
    ]);
    expect(after).toEqual(
      versions({
        'Kept.md': meeting('aa'),
        'Edited.md': { type: 'task', digest: 'ee' },
        'New.md': { type: null, digest: 'dd' },
      }),
    );
  });

  it('leaves the versions it was given as they were', () => {
    const before = versions({ 'Gone.md': meeting('cc') });
    versionsAfter(before, [{ kind: 'removed', path: 'Gone.md', type: 'meeting', digest: 'cc' }]);
    expect(before.has('Gone.md')).toBe(true);
  });
});

describe('arrivedPaths', () => {
  const change = (kind: NoteChange['kind'], path: string, digest: string): NoteChange => ({
    kind,
    path,
    type: 'meeting',
    digest,
  });

  it('takes a note added with bytes nothing else left with as arrived', () => {
    const arrived = arrivedPaths([
      change('added', 'New.md', 'aa'),
      change('changed', 'Edited.md', 'bb'),
      change('removed', 'Gone.md', 'cc'),
    ]);
    expect([...arrived]).toEqual(['New.md']);
  });

  it('pairs a note added with one removed with the same bytes, as a move', () => {
    const arrived = arrivedPaths([
      change('removed', 'Inbox/Standup.md', 'aa'),
      change('added', 'Meetings/Standup.md', 'aa'),
      change('added', 'Meetings/Other.md', 'bb'),
    ]);
    expect([...arrived]).toEqual(['Meetings/Other.md']);
  });
});

describe('noteVersionKey', () => {
  it('tells apart versions whose path and digest only run together the same', () => {
    expect(noteVersionKey('a', 'bc')).not.toBe(noteVersionKey('ab', 'c'));
    expect(noteVersionKey('a.md', 'x')).toBe(noteVersionKey('a.md', 'x'));
  });
});
