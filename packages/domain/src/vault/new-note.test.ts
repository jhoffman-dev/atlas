import { describe, expect, it } from 'vitest';
import { createVaultPath, VAULT_ROOT } from './vault-path.ts';
import {
  isUnnamed,
  NEW_NOTE_CONTENTS,
  nextAvailableFolderPath,
  nextAvailableNotePath,
  noteFileName,
} from './new-note.ts';

describe('nextAvailableFolderPath', () => {
  const taken = (...paths: string[]) => new Set(paths);

  it('uses the name it was given, in the folder it was given', () => {
    expect(
      nextAvailableFolderPath({
        parent: createVaultPath('Work'),
        name: 'Projects',
        taken: taken(),
      }),
    ).toBe('Work/Projects');
  });

  it('calls an unnamed folder New folder', () => {
    expect(nextAvailableFolderPath({ parent: VAULT_ROOT, name: ' .. ', taken: taken() })).toBe(
      'New folder',
    );
  });

  it('cleans a name the way a note name is cleaned', () => {
    expect(nextAvailableFolderPath({ parent: VAULT_ROOT, name: 'a/b:c', taken: taken() })).toBe(
      'a b c',
    );
  });

  it('numbers a name that is taken, by a folder or a note, in any case', () => {
    expect(
      nextAvailableFolderPath({
        parent: VAULT_ROOT,
        name: 'New folder',
        taken: taken('new folder', 'New folder 2'),
      }),
    ).toBe('New folder 3');
  });
});

describe('noteFileName', () => {
  it('adds the markdown extension', () => {
    expect(noteFileName('Weekly review')).toBe('Weekly review.md');
  });

  it('keeps an extension that is already there', () => {
    expect(noteFileName('notes.md')).toBe('notes.md');
    expect(noteFileName('notes.markdown')).toBe('notes.markdown');
  });

  it('keeps unicode and punctuation that filesystems allow', () => {
    expect(noteFileName('Reunión — año (2026)')).toBe('Reunión — año (2026).md');
  });

  it.each([
    ['a path separator', 'Notes/today', 'Notes today.md'],
    ['a backslash', 'a\\b', 'a b.md'],
    ['a colon', 'plan: draft', 'plan draft.md'],
    ['characters Windows refuses', 'a*b?c"d<e>f|g', 'a b c d e f g.md'],
  ])('replaces %s', (_label, input, expected) => {
    expect(noteFileName(input)).toBe(expected);
  });

  it('collapses runs of whitespace', () => {
    expect(noteFileName('  a   b  ')).toBe('a b.md');
  });

  it('does not create a hidden file', () => {
    expect(noteFileName('.env')).toBe('env.md');
  });

  it.each(['', '   ', '...', '///'])('falls back to a default for %j', (input) => {
    expect(noteFileName(input)).toBe('Untitled.md');
  });
});

describe('nextAvailableNotePath', () => {
  const taken = (...paths: string[]) => new Set(paths);

  it('uses the plain name when nothing is in the way', () => {
    expect(nextAvailableNotePath({ folder: VAULT_ROOT, name: 'Untitled', taken: taken() })).toBe(
      'Untitled.md',
    );
  });

  it('numbers from two when the name is taken', () => {
    expect(
      nextAvailableNotePath({ folder: VAULT_ROOT, name: 'Untitled', taken: taken('Untitled.md') }),
    ).toBe('Untitled 2.md');
  });

  it('keeps counting past a gap', () => {
    expect(
      nextAvailableNotePath({
        folder: VAULT_ROOT,
        name: 'Untitled',
        taken: taken('Untitled.md', 'Untitled 2.md', 'Untitled 3.md'),
      }),
    ).toBe('Untitled 4.md');
  });

  it('creates inside a folder', () => {
    expect(
      nextAvailableNotePath({ folder: createVaultPath('Notes'), name: 'Today', taken: taken() }),
    ).toBe('Notes/Today.md');
  });

  it('only counts names taken in the same folder', () => {
    expect(
      nextAvailableNotePath({
        folder: createVaultPath('Notes'),
        name: 'Today',
        taken: taken('Today.md'),
      }),
    ).toBe('Notes/Today.md');
  });

  it('keeps the extension when numbering', () => {
    expect(
      nextAvailableNotePath({
        folder: VAULT_ROOT,
        name: 'notes.markdown',
        taken: taken('notes.markdown'),
      }),
    ).toBe('notes 2.markdown');
  });

  // APFS and NTFS refuse a name that differs only in case from one already there.
  it('numbers a name taken in another case', () => {
    expect(
      nextAvailableNotePath({ folder: VAULT_ROOT, name: 'call sam', taken: taken('Call Sam.md') }),
    ).toBe('call sam 2.md');
  });

  it('numbers past a numbered copy taken in another case', () => {
    expect(
      nextAvailableNotePath({
        folder: createVaultPath('Work'),
        name: 'Untitled',
        taken: taken('Work/untitled.md', 'Work/UNTITLED 2.md'),
      }),
    ).toBe('Work/Untitled 3.md');
  });
});

describe('names the disk treats as one are taken (A20-05)', () => {
  const nfd = 'Cafe\u0301';
  const nfc = 'Caf\u00e9';

  it('numbers a note whose name is taken in another Unicode composition', () => {
    const taken = new Set([`Notes/${nfd}.md`]);
    expect(nextAvailableNotePath({ folder: createVaultPath('Notes'), name: nfc, taken })).toBe(
      `Notes/${nfc} 2.md`,
    );
  });

  it('numbers a folder whose name is taken in another Unicode composition', () => {
    const taken = new Set([nfd]);
    expect(nextAvailableFolderPath({ parent: VAULT_ROOT, name: nfc, taken })).toBe(`${nfc} 2`);
  });
});

describe('isUnnamed', () => {
  it.each([[''], ['   '], ['...'], ['. .'], ['///'], ['\t']])('is true for %j', (typed) => {
    expect(isUnnamed(typed)).toBe(true);
  });

  it.each([['Untitled'], ['.x'], ['a']])('is false for %j', (typed) => {
    expect(isUnnamed(typed)).toBe(false);
  });
});

describe('NEW_NOTE_CONTENTS', () => {
  it('starts a note empty, with no heading to repeat its name', () => {
    expect(NEW_NOTE_CONTENTS).toBe('');
  });
});

describe('noteFileName (adversarial)', () => {
  // The leading dots are stripped before the final trim, so a space between
  // two dots survives the strip and the trim then puts a dot first again.
  it.each([['. .env'], ['. . .x'], ['.\t.x'], ['/ .x']])(
    'never starts the name %j with a dot, which would hide the note',
    (typed) => {
      expect(noteFileName(typed).startsWith('.')).toBe(false);
    },
  );
});
