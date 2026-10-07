import { describe, expect, it } from 'vitest';
import {
  GitListingError,
  parseIndexEntries,
  parseOmittedObjects,
  parsePathList,
  parseTree,
} from './git-listings.ts';

const HASH = 'a'.repeat(40);
const z = (...records: string[]) => records.map((record) => `${record}\0`).join('');

describe('parsePathList', () => {
  it('splits a `-z` listing on NUL, one path per record', () => {
    expect(parsePathList(z('Notes/A.md', 'Notes/B.md'))).toEqual(['Notes/A.md', 'Notes/B.md']);
  });

  it('drops the empty record `-z` trails with, and reads nothing as no paths', () => {
    expect(parsePathList('a\0b\0')).toEqual(['a', 'b']);
    expect(parsePathList('')).toEqual([]);
  });
});

describe('parseIndexEntries', () => {
  it('reads mode, blob, stage and path from each record', () => {
    const entries = parseIndexEntries(
      z(`100644 ${HASH} 0\tNotes/Idea.md`, `100755 ${HASH} 0\tbin/run.sh`),
    );
    expect(entries).toEqual([
      { mode: '100644', oid: HASH, stage: 0, path: 'Notes/Idea.md' },
      { mode: '100755', oid: HASH, stage: 0, path: 'bin/run.sh' },
    ]);
  });

  it.each([0, 1, 2, 3] as const)('reads stage %d', (stage) => {
    const [entry] = parseIndexEntries(z(`100644 ${HASH} ${stage}\tNote.md`));
    expect(entry?.stage).toBe(stage);
  });

  it('keeps a path that itself holds a tab or a newline, since only one tab precedes it', () => {
    const [entry] = parseIndexEntries(z(`100644 ${HASH} 0\tNotes/A\tB\nC.md`));
    expect(entry?.path).toBe('Notes/A\tB\nC.md');
  });

  it.each([
    ['a short mode', z(`1006 ${HASH} 0\tNote.md`)],
    ['an invalid oid', z(`100644 not-hex 0\tNote.md`)],
    ['a stage outside 0-3', z(`100644 ${HASH} 4\tNote.md`)],
    ['no path at all', z(`100644 ${HASH} 0`)],
  ])('refuses %s rather than guessing', (_name, raw) => {
    expect(() => parseIndexEntries(raw)).toThrow(GitListingError);
  });
});

describe('parseTree', () => {
  it('maps each path to its mode and blob', () => {
    const tree = parseTree(z(`100644 blob ${HASH}\tNotes/Idea.md`, `040000 tree ${HASH}\tNotes`));
    expect(tree.get('Notes/Idea.md')).toEqual({ mode: '100644', oid: HASH, path: 'Notes/Idea.md' });
    expect(tree.get('Notes')).toEqual({ mode: '040000', oid: HASH, path: 'Notes' });
    expect(tree.size).toBe(2);
  });

  it('reads nothing as an empty tree', () => {
    expect(parseTree('').size).toBe(0);
  });

  it.each([
    ['a short record', z('100644 blob')],
    ['an invalid oid', z('100644 blob not-hex\tNote.md')],
  ])('refuses %s rather than guessing', (_name, raw) => {
    expect(() => parseTree(raw)).toThrow(GitListingError);
  });
});

describe('parseOmittedObjects', () => {
  it('collects each blob after its `~`', () => {
    const B = 'b'.repeat(64);
    const omitted = parseOmittedObjects(`~${HASH}\n~${B}\n`);
    expect(omitted).toEqual(new Set([HASH, B]));
  });

  it('ignores lines that are not an omitted blob, and trims whitespace', () => {
    expect(parseOmittedObjects(`some other line\n  ~${HASH}  \n\n`)).toEqual(new Set([HASH]));
  });

  it('reads nothing as nothing omitted', () => {
    expect(parseOmittedObjects('').size).toBe(0);
  });
});
