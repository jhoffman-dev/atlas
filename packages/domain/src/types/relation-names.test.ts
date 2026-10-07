/**
 * A relation is stored as `[[Note]]` and shown as the note it names —
 * its title, by the same rule every list uses — never as the link.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { holdsLinks, linkedNames, noteNames, withNoteNames } from './relation-names.ts';

const note = (path: string, title: string) => ({ path: createVaultPath(path), title });

const names = noteNames([
  note('Atlas.md', 'Atlas'),
  note('people/Ada Lovelace.md', 'Ada Lovelace'),
  note('A15-03.md', 'Split the sidebar'),
  note('projects/Garden.md', 'Garden'),
]);

describe('linkedNames', () => {
  it('names a linked note by its title', () => {
    expect(linkedNames('[[Atlas]]', names)).toEqual([
      { text: 'Atlas', path: 'Atlas.md', missing: false },
    ]);
  });

  it('uses the title the note gives itself, not its filename', () => {
    expect(linkedNames('[[A15-03]]', names)).toEqual([
      { text: 'Split the sidebar', path: 'A15-03.md', missing: false },
    ]);
  });

  it('shows the alias a link was given', () => {
    expect(linkedNames('[[Atlas|The app]]', names)).toEqual([
      { text: 'The app', path: 'Atlas.md', missing: false },
    ]);
  });

  it('resolves a link spelled as a path, or in another case, the way links do', () => {
    expect(linkedNames('[[projects/Garden]]', names)[0]?.path).toBe('projects/Garden.md');
    expect(linkedNames('[[ada lovelace]]', names)[0]).toEqual({
      text: 'Ada Lovelace',
      path: 'people/Ada Lovelace.md',
      missing: false,
    });
  });

  it('shows a link to nothing as its bare name, marked missing', () => {
    expect(linkedNames('[[archive/Gone.md]]', names)).toEqual([
      { text: 'Gone', path: null, missing: true },
    ]);
  });

  it('reads every link in a list, or in the joined cell a view makes of one', () => {
    const both = [
      { text: 'Atlas', path: 'Atlas.md', missing: false },
      { text: 'Ada Lovelace', path: 'people/Ada Lovelace.md', missing: false },
    ];
    expect(linkedNames(['[[Atlas]]', '[[Ada Lovelace]]'], names)).toEqual(both);
    expect(linkedNames('[[Atlas]], [[Ada Lovelace]]', names)).toEqual(both);
  });

  it('finds nothing in an empty value or in plain text', () => {
    expect(linkedNames(null, names)).toEqual([]);
    expect(linkedNames('', names)).toEqual([]);
    expect(linkedNames('Atlas', names)).toEqual([]);
  });

  it('marks nothing missing before the notes are known', () => {
    expect(linkedNames('[[Gone]]', noteNames(null))).toEqual([
      { text: 'Gone', path: null, missing: false },
    ]);
  });
});

describe('withNoteNames', () => {
  it('writes each link in a value as the note it names, and keeps the text around it', () => {
    expect(withNoteNames('[[Atlas]]', names)).toBe('Atlas');
    expect(withNoteNames('[[Atlas]], [[A15-03]]', names)).toBe('Atlas, Split the sidebar');
    expect(withNoteNames(['[[Atlas]]', '[[Gone]]'], names)).toBe('Atlas, Gone');
    expect(withNoteNames('see [[Atlas|the app]] first', names)).toBe('see the app first');
  });

  it('leaves a value with no link as it is', () => {
    expect(withNoteNames('doing', names)).toBe('doing');
    expect(withNoteNames(3, names)).toBe('3');
    expect(withNoteNames(null, names)).toBe('');
  });
});

describe('holdsLinks', () => {
  it('is true of a link, or a list of links, and nothing else', () => {
    expect(holdsLinks('[[Atlas]]')).toBe(true);
    expect(holdsLinks(['[[Atlas]]', '[[Garden]]'])).toBe(true);
    expect(holdsLinks('see [[Atlas]]')).toBe(false);
    expect(holdsLinks(['[[Atlas]]', 'plain'])).toBe(false);
    expect(holdsLinks([])).toBe(false);
    expect(holdsLinks(null)).toBe(false);
    expect(holdsLinks('Atlas')).toBe(false);
  });
});

describe('linkTo', () => {
  it('links a note by its bare name, or by its path when the name alone opens another', () => {
    const clash = noteNames([note('Atlas.md', 'Atlas'), note('old/Atlas.md', 'Atlas')]);
    expect(clash.linkTo(createVaultPath('Atlas.md'))).toBe('[[Atlas]]');
    expect(clash.linkTo(createVaultPath('old/Atlas.md'))).toBe('[[old/Atlas]]');
  });

  it('links a titled note by its filename, which is what resolves', () => {
    expect(names.linkTo(createVaultPath('A15-03.md'))).toBe('[[A15-03]]');
  });
});

describe('opens', () => {
  it('is the note a link opens, or null', () => {
    expect(names.opens('[[Atlas|x]]')).toBe('Atlas.md');
    expect(names.opens('[[Gone]]')).toBeNull();
    expect(names.opens('Atlas')).toBeNull();
  });
});
