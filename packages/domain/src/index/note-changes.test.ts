import { describe, expect, it } from 'vitest';
import { triggeringVersions } from '../automations/note-trigger.ts';
import {
  arrivedPaths,
  noteChangesBetween,
  unpairedChanges,
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
    ).toEqual([
      { kind: 'changed', path: 'Kickoff.md', type: 'meeting', digest: 'bb', before: 'aa' },
    ]);
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

describe('noteChangesBetween: how the meeting import settled a note (#92)', () => {
  it('carries the stamp a note holds now, and on a changed note the one it held before', () => {
    const plain = meeting('plain');
    const stamped: NoteVersion = { ...meeting('stamped'), importOutcome: 'imported' };
    expect(
      noteChangesBetween(
        versions({ 'Standup.md': plain, 'Retro.md': { ...plain, importOutcome: 'error' } }),
        versions({ 'Standup.md': stamped, 'Retro.md': stamped, 'New.md': stamped }),
      ),
    ).toEqual([
      { kind: 'changed', path: 'Standup.md', ...stamped, before: 'plain' },
      {
        kind: 'changed',
        path: 'Retro.md',
        ...stamped,
        before: 'plain',
        beforeImportOutcome: 'error',
      },
      { kind: 'added', path: 'New.md', ...stamped },
    ]);
  });

  it('keeps the stamp in the versions the next sync is measured from', () => {
    const after = versionsAfter(new Map(), [
      { kind: 'added', path: 'New.md', type: 'meeting', digest: 'aa', importOutcome: 'imported' },
    ]);
    expect(after.get('New.md')).toEqual({
      type: 'meeting',
      digest: 'aa',
      importOutcome: 'imported',
    });
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

  it('pairs a note put back from the Archive with where it went, though its bytes changed', () => {
    const changes = [
      change('removed', 'Archive/Inbox/Standup.md', 'stamped'),
      change('added', 'Inbox/Standup.md', 'plain'),
    ];
    expect([...arrivedPaths(changes)]).toEqual([]);
    expect([...unpairedChanges(changes).left]).toEqual(['Archive/Inbox/Standup.md']);
  });

  it('pairs a note put back under the number a taken name gets, one to one', () => {
    const changes = [
      change('removed', 'Archive/Inbox/Standup.md', 'stamped'),
      change('added', 'Inbox/Standup 2.md', 'plain'),
      change('added', 'Inbox/Standup 3.md', 'new'),
    ];
    expect([...arrivedPaths(changes)]).toEqual(['Inbox/Standup 3.md']);
  });

  it('does not let a note archived in the same sync swallow a new note with its old bytes', () => {
    const changes = [
      change('removed', 'Inbox/Standup.md', 'template'),
      change('added', 'Archive/Inbox/Standup.md', 'stamped'),
      change('added', 'Inbox/Retro.md', 'template'),
    ];
    expect([...arrivedPaths(changes)]).toEqual(['Inbox/Retro.md']);
  });

  it('takes one of a copy and a move from one note as the move, the other as arrived', () => {
    const changes = [
      change('removed', 'Inbox/Standup.md', 'aa'),
      change('added', 'Inbox/Standup copy.md', 'aa'),
      change('added', 'Meetings/Standup.md', 'aa'),
    ];
    expect([...arrivedPaths(changes)]).toEqual(['Inbox/Standup copy.md']);
  });

  it('pairs a rename by its bytes when no note of the same name went', () => {
    const changes = [
      change('removed', 'Inbox/Standup.md', 'aa'),
      change('added', 'Inbox/Daily standup.md', 'aa'),
    ];
    expect([...arrivedPaths(changes)]).toEqual([]);
  });

  it('says every path a note left, moved or deleted', () => {
    const changes = [
      change('removed', 'Inbox/Moved.md', 'aa'),
      change('added', 'Meetings/Moved.md', 'aa'),
      change('removed', 'Inbox/Deleted.md', 'bb'),
    ];
    expect([...unpairedChanges(changes).left]).toEqual(['Inbox/Moved.md', 'Inbox/Deleted.md']);
  });

  it('takes a path changed to bytes of its own, while its old bytes were archived, as a new note there', () => {
    const changes: NoteChange[] = [
      { ...change('changed', 'Inbox/Standup.md', 'next'), before: 'old' },
      change('added', 'Archive/Inbox/Standup.md', 'stamped'),
    ];
    const { arrived, left } = unpairedChanges(changes);
    expect([...arrived]).toEqual(['Inbox/Standup.md']);
    expect([...left]).toEqual(['Inbox/Standup.md']);
  });

  it('takes a path changed while its old bytes moved away as a new note there, and the move as no arrival', () => {
    const changes: NoteChange[] = [
      { ...change('changed', 'Inbox/Standup.md', 'next'), before: 'old' },
      change('added', 'Meetings/Standup.md', 'old'),
    ];
    expect([...arrivedPaths(changes)]).toEqual(['Inbox/Standup.md']);
  });

  it('never reads a new meeting as a renamed old one when the import has only stamped the old one (#92)', () => {
    // The import stamps a meeting that waited in its folder in the same sync as a new meeting,
    // with the bytes the old one had, lands beside it: the first stamp is not a file made anew.
    const changes: NoteChange[] = [
      {
        ...change('changed', 'Inbox/Meetings/Last week standup.md', 'stamped'),
        importOutcome: 'imported',
        before: 'same',
      },
      change('added', 'Inbox/Meetings/Standup.md', 'same'),
    ];
    const { arrived, left } = unpairedChanges(changes);
    expect([...arrived]).toEqual(['Inbox/Meetings/Standup.md']);
    expect([...left]).toEqual([]);
  });

  it('never reads an edit of a let-in meeting as the meeting filed away, though a note of its name is made elsewhere (#92)', () => {
    const changes: NoteChange[] = [
      {
        ...change('changed', 'Inbox/Meetings/Weekly sync.md', 'edited'),
        importOutcome: 'imported',
        before: 'stamped',
        beforeImportOutcome: 'imported',
      },
      change('added', 'Projects/Weekly sync.md', 'made'),
    ];
    const { arrived, left } = unpairedChanges(changes);
    expect([...arrived]).toEqual(['Projects/Weekly sync.md']);
    expect([...left]).toEqual([]);
  });

  it('takes a let-in meeting renamed, with a new file landing at its old name, as a rename and a new file (#92)', () => {
    const changes: NoteChange[] = [
      {
        ...change('changed', 'Inbox/Meetings/Weekly sync.md', 'this-week'),
        before: 'last-week',
        beforeImportOutcome: 'imported',
      },
      {
        ...change('added', 'Inbox/Meetings/Weekly sync 2026-10-05.md', 'last-week'),
        importOutcome: 'imported',
      },
    ];
    const { arrived, left } = unpairedChanges(changes);
    expect([...arrived]).toEqual(['Inbox/Meetings/Weekly sync.md']);
    expect([...left]).toEqual(['Inbox/Meetings/Weekly sync.md']);
  });

  it('leaves a plain edit an edit: nothing went from its path', () => {
    const changes: NoteChange[] = [
      { ...change('changed', 'Inbox/Standup.md', 'next'), before: 'old' },
      change('added', 'Meetings/Other.md', 'other'),
    ];
    const { arrived, left } = unpairedChanges(changes);
    expect([...arrived]).toEqual(['Meetings/Other.md']);
    expect([...left]).toEqual([]);
  });
});

describe("the feed remembers a meeting's arrival was heard (#92)", () => {
  const landed = 'Inbox/Meetings/Retro.md';
  const stamped = (digest: string): NoteVersion => ({
    type: 'meeting',
    digest,
    importOutcome: 'imported',
  });

  /** Syncs a path from one state of the vault to the next, as the feed does, and answers what each heard. */
  function heardAcross(states: readonly Record<string, NoteVersion>[]) {
    let held: ReadonlyMap<string, NoteVersion> = new Map();
    return states.map((state) => {
      const next = versions(state);
      const changes = noteChangesBetween(held, next);
      held = versionsAfter(held, changes);
      return triggeringVersions({ kind: 'note', type: 'meeting', on: ['created'] }, changes);
    });
  }

  it('hears a meeting made outside, moved in and stamped, once', () => {
    const heard = heardAcross([
      { 'Meetings/Retro.md': meeting('plain') },
      { [landed]: meeting('plain') },
      { [landed]: stamped('stamped') },
    ]);
    expect(heard.flat()).toHaveLength(1);
  });

  it('hears a meeting whose stamp was lost and restored once', () => {
    const heard = heardAcross([
      { [landed]: meeting('plain') },
      { [landed]: stamped('stamped') },
      { [landed]: meeting('unstamped') },
      { [landed]: stamped('restamped') },
    ]);
    expect(heard.flat()).toEqual([{ path: landed, digest: 'stamped' }]);
  });

  it('hears a new file made where a let-in meeting was renamed away, when the import lets it in', () => {
    const renamed = 'Inbox/Meetings/Retro 2026-10-05.md';
    const heard = heardAcross([
      { [landed]: stamped('last-week') },
      { [landed]: meeting('this-week'), [renamed]: stamped('last-week') },
      { [landed]: stamped('this-week-stamped'), [renamed]: stamped('last-week') },
    ]);
    expect(heard.flat()).toEqual([{ path: landed, digest: 'this-week-stamped' }]);
  });
});
