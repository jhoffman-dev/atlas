import { describe, expect, it } from 'vitest';
import { KeyAsWritten } from '../markdown/frontmatter-key.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import {
  activeNotePaths,
  archivedDay,
  archivedNote,
  archiveDestination,
  archiveRefusal,
  archiveStamp,
  unarchiveStamp,
  freeNotePath,
  isArchivedPath,
  isArchiveFolder,
  isArchiveMove,
  originOf,
  restoreDestination,
  unarchiveRefusal,
} from './archive.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);
const taken = (...paths: string[]): ReadonlySet<string> => new Set(paths);

describe('isArchivedPath', () => {
  it.each(['Archive/X.md', 'Archive/Projects/X.md', 'archive/X.md', 'ARCHIVE/deep/er/X.md'])(
    'calls %j archived',
    (raw) => expect(isArchivedPath(raw)).toBe(true),
  );

  it.each(['X.md', 'Projects/Archive/X.md', 'Archives/X.md', 'Archive.md', 'Archive'])(
    'does not call %j archived',
    (raw) => expect(isArchivedPath(raw)).toBe(false),
  );
});

describe('isArchiveFolder', () => {
  it('is the root folder called Archive, in any case', () => {
    expect(isArchiveFolder({ kind: 'directory', name: 'Archive', path: path('Archive') })).toBe(
      true,
    );
    expect(isArchiveFolder({ kind: 'directory', name: 'archive', path: path('archive') })).toBe(
      true,
    );
  });

  it('is not a folder of that name further down, nor a note', () => {
    expect(
      isArchiveFolder({ kind: 'directory', name: 'Archive', path: path('Projects/Archive') }),
    ).toBe(false);
    expect(isArchiveFolder({ kind: 'file', name: 'Archive', path: path('Archive') })).toBe(false);
  });
});

describe('activeNotePaths', () => {
  it('keeps every note outside the Archive, in order', () => {
    const paths = ['b.md', 'Archive/a.md', 'Projects/Archive/c.md', 'a.md'].map(path);
    expect(activeNotePaths(paths)).toEqual(['b.md', 'Projects/Archive/c.md', 'a.md']);
  });
});

describe('archiveRefusal', () => {
  it('allows an ordinary note anywhere', () => {
    expect(archiveRefusal(path('Projects/X.md'))).toBeNull();
    expect(archiveRefusal(path('X.md'))).toBeNull();
  });

  it('refuses what Atlas keeps for itself', () => {
    expect(archiveRefusal(path('.atlas/views/Board.md'))).toMatch(/Atlas keeps/);
  });

  it('refuses a note already in the Archive', () => {
    expect(archiveRefusal(path('Archive/X.md'))).toMatch(/already archived/);
  });

  it('refuses a file that is not a note', () => {
    expect(archiveRefusal(path('attachments/pic.png'))).toMatch(/Only notes/);
  });
});

describe('unarchiveRefusal', () => {
  it('allows only a note in the Archive', () => {
    expect(unarchiveRefusal(path('Archive/X.md'))).toBeNull();
    expect(unarchiveRefusal(path('X.md'))).toMatch(/not archived/);
  });
});

describe('freeNotePath', () => {
  it('keeps the path when nothing has it', () => {
    expect(freeNotePath(path('A/X.md'), taken('A/Y.md'))).toBe('A/X.md');
  });

  it('numbers past what is taken, the way Finder numbers copies', () => {
    expect(freeNotePath(path('A/X.md'), taken('A/X.md', 'A/X 2.md'))).toBe('A/X 3.md');
  });

  it('counts a path taken in another case as taken', () => {
    expect(freeNotePath(path('A/X.md'), taken('a/x.md'))).toBe('A/X 2.md');
  });

  it('numbers at the root too', () => {
    expect(freeNotePath(path('X.md'), taken('X.md'))).toBe('X 2.md');
  });
});

describe('archiveDestination', () => {
  it('keeps the note’s folder path under Archive', () => {
    expect(archiveDestination({ path: path('Projects/X.md'), taken: taken() })).toBe(
      'Archive/Projects/X.md',
    );
    expect(archiveDestination({ path: path('X.md'), taken: taken() })).toBe('Archive/X.md');
  });

  it('files it under the Archive as the disk spells it', () => {
    expect(
      archiveDestination({ path: path('X.md'), taken: taken(), archive: path('archive') }),
    ).toBe('archive/X.md');
  });

  it('numbers the name when an archived note already has it', () => {
    expect(
      archiveDestination({ path: path('Projects/X.md'), taken: taken('Archive/Projects/X.md') }),
    ).toBe('Archive/Projects/X 2.md');
  });
});

describe('restoreDestination', () => {
  it('goes back to the path the note recorded', () => {
    expect(
      restoreDestination({
        path: path('Archive/Projects/X 2.md'),
        archivedFrom: 'Projects/X.md',
        taken: taken(),
      }),
    ).toBe('Projects/X.md');
  });

  it('numbers the name when something has taken the path since', () => {
    expect(
      restoreDestination({
        path: path('Archive/Projects/X.md'),
        archivedFrom: 'Projects/X.md',
        taken: taken('Projects/X.md'),
      }),
    ).toBe('Projects/X 2.md');
  });

  it.each([
    ['nothing recorded', undefined],
    ['a record that is not text', 42],
    ['a path out of the vault', '../../etc/passwd.md'],
    ['an absolute path', '/Users/me/X.md'],
    ['a path back into the Archive', 'Archive/Other.md'],
    ['a path into .atlas', '.atlas/types/X.md'],
    ['a path the vault hides', '.git/X.md'],
    ['a file that is not a note', 'Projects/X.png'],
  ])('with %s, goes back to its path without Archive/', (_label, archivedFrom) => {
    expect(
      restoreDestination({ path: path('Archive/Projects/X.md'), archivedFrom, taken: taken() }),
    ).toBe('Projects/X.md');
  });

  it('takes every Archive/ off a note filed twice over by hand', () => {
    expect(originOf(path('Archive/archive/X.md'), undefined)).toBe('X.md');
  });

  // A20-06: a record naming another folder is no longer followed; see archive-destination.test.ts.
  it('ignores a record naming another place, spaces and all', () => {
    expect(originOf(path('Archive/X.md'), '  Notes/X.md ')).toBe('X.md');
  });
});

describe('archiveStamp', () => {
  it('records the day and where the note was, under the documented keys', () => {
    expect(archiveStamp({ from: path('Projects/X.md'), on: '2026-09-27' })).toEqual({
      archived: '2026-09-27',
      archivedFrom: 'Projects/X.md',
    });
  });

  it('is undone by removing exactly those keys from a note that had no block', () => {
    const stamp = archiveStamp({ from: path('X.md'), on: '2026-09-27' });
    const { changes, keepsBlock } = unarchiveStamp(stamp);
    expect(changes).toEqual({ archived: null, archivedFrom: null, archivedPrior: null });
    expect(keepsBlock).toBe(false);
  });

  it('keeps nothing extra for a note with keys of its own and none of the stamp’s (A20-05)', () => {
    const own = { title: 'Plan' };
    expect(archiveStamp({ from: path('X.md'), on: '2026-09-27', own })).toEqual({
      archived: '2026-09-27',
      archivedFrom: 'X.md',
    });
  });

  it('keeps the text of the note’s own keys under the stamp’s, and gives it back (A20-06)', () => {
    // Text, not values: `0x1F` read as a value would be written back as `31`.
    const own = {
      title: 'title: Plan\n',
      archived: 'archived: 0x1F\n',
      archivedFrom: 'archivedFrom:\n',
    };
    const stamp = archiveStamp({ from: path('X.md'), on: '2026-09-27', own });
    expect(stamp).toEqual({
      archived: '2026-09-27',
      archivedFrom: 'X.md',
      archivedPrior: { archived: 'archived: 0x1F\n', archivedFrom: 'archivedFrom:\n' },
    });
    expect(unarchiveStamp(stamp)).toEqual({
      changes: {
        archived: new KeyAsWritten('archived: 0x1F\n'),
        archivedFrom: new KeyAsWritten('archivedFrom:\n'),
        archivedPrior: null,
      },
      keepsBlock: true,
    });
  });

  it('keeps a note’s own `archivedPrior` too, so nothing of its own is written over (A20-05)', () => {
    const own = { archivedPrior: 'archivedPrior: mine\n' };
    const stamp = archiveStamp({ from: path('X.md'), on: '2026-09-27', own });
    expect(stamp['archivedPrior']).toEqual({ archivedPrior: 'archivedPrior: mine\n' });
    expect(unarchiveStamp(stamp).changes['archivedPrior']).toEqual(
      new KeyAsWritten('archivedPrior: mine\n'),
    );
  });

  it('keeps nothing of an entry edited into something that is not text (A20-06)', () => {
    expect(unarchiveStamp({ archivedPrior: { archived: false } }).changes['archived']).toBeNull();
  });

  it('records that a block with no keys was the note’s own, so it is kept (A20-05)', () => {
    const stamp = archiveStamp({ from: path('X.md'), on: '2026-09-27', own: {} });
    expect(stamp['archivedPrior']).toEqual({});
    expect(unarchiveStamp(stamp).keepsBlock).toBe(true);
  });

  it('keeps nothing from a record edited into something that is not a map (A20-05)', () => {
    expect(unarchiveStamp({ archived: 'x', archivedPrior: ['a'] })).toEqual({
      changes: { archived: null, archivedFrom: null, archivedPrior: null },
      keepsBlock: false,
    });
  });
});

describe('archivedDay', () => {
  it.each([
    ['a plain day', '2026-09-27', '2026-09-27'],
    ['a day with a time', '2026-09-27T10:00', '2026-09-27'],
    ['a day with space round it', ' 2026-09-27 ', '2026-09-27'],
    ['a Date, as YAML may read one', new Date('2026-09-27T00:00:00Z'), '2026-09-27'],
  ])('reads %s', (_label, value, day) => expect(archivedDay(value)).toBe(day));

  it.each([
    ['nothing', undefined],
    ['words', 'last week'],
    ['a number', 20260927],
    ['an invalid Date', new Date('nope')],
  ])('reads no day from %s', (_label, value) => expect(archivedDay(value)).toBeNull());
});

describe('archivedNote', () => {
  it('is the note’s title, where it goes back to and the day it was archived', () => {
    expect(
      archivedNote({
        path: path('Archive/Projects/X 2.md'),
        title: 'X',
        properties: { archived: '2026-09-27', archivedFrom: 'Projects/X.md' },
      }),
    ).toEqual({
      path: 'Archive/Projects/X 2.md',
      title: 'X',
      from: 'Projects/X.md',
      archivedOn: '2026-09-27',
    });
  });

  it('works out where a note filed by hand came from, undated', () => {
    expect(
      archivedNote({ path: path('Archive/Old/Y.md'), title: 'Y', properties: {} }),
    ).toMatchObject({ from: 'Old/Y.md', archivedOn: null });
  });
});

describe('isArchiveMove', () => {
  const move = (from: string, to: string) => isArchiveMove(path(from), path(to));

  it('is archiving a note: to its own path under the Archive, numbered when taken', () => {
    expect(move('Inbox/Standup.md', 'Archive/Inbox/Standup.md')).toBe(true);
    expect(move('Inbox/Standup.md', 'archive/inbox/standup.md')).toBe(true);
    expect(move('Inbox/Standup.md', 'Archive/Inbox/Standup 2.md')).toBe(true);
  });

  it('is putting one back: to its path, numbered when taken, or without the number archiving gave it', () => {
    expect(move('Archive/Inbox/Standup.md', 'Inbox/Standup.md')).toBe(true);
    expect(move('Archive/Inbox/Standup.md', 'Inbox/Standup 3.md')).toBe(true);
    expect(move('Archive/Inbox/Standup 2.md', 'Inbox/Standup.md')).toBe(true);
    expect(move('Archive/Inbox/Standup 2.md', 'Inbox/Standup 2.md')).toBe(true);
  });

  it('is no other move: another folder or name, a number archiving could not give, or no Archive', () => {
    expect(move('Inbox/Standup.md', 'Archive/Meetings/Standup.md')).toBe(false);
    expect(move('Archive/Inbox/Standup.md', 'Inbox/Retro.md')).toBe(false);
    expect(move('Archive/Inbox/Standup.md', 'Inbox/Standup 1.md')).toBe(false);
    expect(move('Archive/Inbox/Standup.md', 'Inbox/Standup 02.md')).toBe(false);
    expect(move('Archive/Inbox/Standup.md', 'Inbox/Standupx 2.md')).toBe(false);
    expect(move('Archive/Inbox/Standup 2.md', 'Inbox/Standup 2 2.md')).toBe(true);
    expect(move('Inbox/Standup.md', 'Meetings/Standup.md')).toBe(false);
    expect(move('Archive/A.md', 'Archive/B/A.md')).toBe(false);
  });
});
