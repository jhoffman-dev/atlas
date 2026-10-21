import { describe, expect, it } from 'vitest';
import { parseObjectType } from '../types/property-def.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { newNoteFolder } from '../vault/new-note-folder.ts';
import {
  expandHomeFolder,
  homeFolderOf,
  homeFolderTemplate,
  noteDay,
  settledFolderOf,
} from './home-folder.ts';

const TODAY = '2026-10-14';
const path = createVaultPath;
const typeFile = (frontmatter: Record<string, unknown>) => parseObjectType(frontmatter);

describe('the built-in home folders (#214)', () => {
  it.each([
    ['task', 'Tasks/2026/10'],
    ['meeting', 'Meetings/2026/10'],
    ['daily', 'Daily/2026'],
    ['person', 'People'],
    ['company', 'Companies'],
    ['project', 'Projects'],
    ['area', 'Projects'],
    ['resource', 'Projects'],
    ['notes', 'Notes/2026'],
    ['proposal', 'Inbox/Proposals'],
  ])('puts a %s in %s', (type, folder) => {
    expect(homeFolderOf({ properties: { type }, types: [], today: TODAY })).toBe(folder);
  });

  it('reads the type in any case and spacing, as notes write it', () => {
    expect(homeFolderOf({ properties: { type: ' Task ' }, types: [], today: TODAY })).toBe(
      'Tasks/2026/10',
    );
  });

  it('has none for a note with no type, or of a type that is not built in', () => {
    expect(homeFolderOf({ properties: {}, types: [], today: TODAY })).toBeNull();
    expect(homeFolderOf({ properties: { type: '' }, types: [], today: TODAY })).toBeNull();
    expect(homeFolderOf({ properties: { type: 'recipe' }, types: [], today: TODAY })).toBeNull();
    expect(homeFolderOf({ properties: { type: 'decision' }, types: [], today: TODAY })).toBeNull();
  });
});

describe('the date tokens', () => {
  it('take the year and month from the note’s own date', () => {
    const properties = { type: 'meeting', date: '2025-03-09' };
    expect(homeFolderOf({ properties, types: [], today: TODAY })).toBe('Meetings/2025/03');
  });

  it('read a date with a time after it by its day', () => {
    expect(noteDay({ properties: { date: '2025-12-31T23:30' }, path: null, today: TODAY })).toBe(
      '2025-12-31',
    );
  });

  it('take a date the file name starts with when the note has none: a daily note, a meeting', () => {
    expect(noteDay({ properties: {}, path: path('2024-02-29.md'), today: TODAY })).toBe(
      '2024-02-29',
    );
    expect(
      noteDay({ properties: {}, path: path('Inbox/Meetings/2025-07-01 Sync.md'), today: TODAY }),
    ).toBe('2025-07-01');
  });

  it('take today when the note says no date at all, or one that is not a day', () => {
    expect(noteDay({ properties: {}, path: path('Plan.md'), today: TODAY })).toBe(TODAY);
    expect(noteDay({ properties: { date: 'soon' }, path: null, today: TODAY })).toBe(TODAY);
    expect(noteDay({ properties: { date: 20251001 }, path: null, today: TODAY })).toBe(TODAY);
  });

  it('prefer the note’s date over the name it is filed under', () => {
    const properties = { date: '2025-01-05' };
    expect(noteDay({ properties, path: path('2024-06-01 Old.md'), today: TODAY })).toBe(
      '2025-01-05',
    );
  });
});

describe('a type file’s own folder', () => {
  it('wins over the built-in default, with its tokens filled in', () => {
    const types = [typeFile({ name: 'task', folder: 'Work/Tasks/{YYYY}' })];
    expect(homeFolderTemplate('task', types)).toBe('Work/Tasks/{YYYY}');
    expect(homeFolderOf({ properties: { type: 'task' }, types, today: TODAY })).toBe(
      'Work/Tasks/2026',
    );
  });

  it('gives a type that is not built in a home', () => {
    const types = [typeFile({ name: 'recipe', folder: 'Kitchen/{MM}' })];
    expect(homeFolderOf({ properties: { type: 'recipe' }, types, today: TODAY })).toBe(
      'Kitchen/10',
    );
  });

  it('says the type has no home when it is written blank, or with nothing after it', () => {
    for (const folder of ['', '  ', null]) {
      const types = [typeFile({ name: 'task', folder })];
      expect(homeFolderOf({ properties: { type: 'task' }, types, today: TODAY })).toBeNull();
    }
  });

  it('is left unread when it is not text, so the default stands', () => {
    const types = [typeFile({ name: 'task', folder: ['Tasks'] })];
    expect(homeFolderOf({ properties: { type: 'task' }, types, today: TODAY })).toBe(
      'Tasks/2026/10',
    );
  });

  // Never a refusal: a folder that cannot be used is passed by, and the note goes where it always went.
  it.each([
    ['a token it does not know', 'Tasks/{DD}'],
    ['a path out of the vault', '../Elsewhere'],
    ['an absolute path', '/Users/someone'],
    ['DFAI’s own folder', '.atlas/tasks'],
    ['a hidden folder', 'Tasks/.hidden'],
    ['the Archive', 'Archive/Tasks'],
    ['the Archive in another case', 'archive'],
  ])('cannot be used when it holds %s', (_name, folder) => {
    const types = [typeFile({ name: 'task', folder })];
    expect(homeFolderOf({ properties: { type: 'task' }, types, today: TODAY })).toBeNull();
  });

  it('cannot be deeper than the vault is read', () => {
    const deep = Array.from({ length: 33 }, (_, at) => `f${at}`).join('/');
    expect(expandHomeFolder(deep, TODAY)).toBeNull();
    expect(expandHomeFolder(deep.split('/').slice(0, 32).join('/'), TODAY)).not.toBeNull();
  });
});

describe('where a note settles when it is tidied or filed', () => {
  it('is its type’s home, or Notes for the year for a plain note', () => {
    const at = path('Plan.md');
    expect(
      settledFolderOf({ properties: { type: 'task' }, path: at, types: [], today: TODAY }),
    ).toBe('Tasks/2026/10');
    expect(settledFolderOf({ properties: {}, path: at, types: [], today: TODAY })).toBe(
      'Notes/2026',
    );
  });

  it('is nowhere for a note whose type has no home: it stays', () => {
    expect(
      settledFolderOf({
        properties: { type: 'decision' },
        path: path('Ship.md'),
        types: [],
        today: TODAY,
      }),
    ).toBeNull();
  });
});

describe('newNoteFolder with a home folder', () => {
  const acme = path('Clients/Acme.md');

  it('puts a note of a type with a home there, whatever is in view', () => {
    const home = path('Tasks/2026/10');
    expect(newNoteFolder({ beside: acme, properties: { type: 'task' }, home })).toBe(home);
    expect(newNoteFolder({ beside: null, properties: { type: 'task' }, home })).toBe(home);
  });

  it('keeps a dashboard and a saved view with their kind, whatever home is given', () => {
    const home = path('Tasks/2026/10');
    expect(newNoteFolder({ beside: acme, properties: { atlas: 'view', type: 'task' }, home })).toBe(
      '.atlas/views',
    );
  });

  it('puts a note with no home beside the one in view, as before', () => {
    expect(newNoteFolder({ beside: acme, properties: {}, home: null })).toBe('Clients');
  });
});
