/**
 * Attacks on the refresh plan.
 *
 * The promise the module makes is that a refresh never loses what you wrote. A
 * key that decides a filename is the soft spot: two records that land on one
 * path make the second refresh overwrite the first record's note.
 */

import { describe, expect, it } from 'vitest';
import { MAX_RECORDS, type Datasource } from './datasource.ts';
import { notePathFor, planRefresh, type ExistingSourceNote } from './merge.ts';

const source: Datasource = {
  format: 'csv',
  url: null,
  file: 'feed.csv',
  headers: {},
  query: null,
  pointer: null,
  into: 'imported',
  type: 'row',
  key: 'id',
  name: 'name',
  body: null,
  map: {},
  interval: 0,
};

const pathFor = (key: string) => notePathFor({ into: 'imported', key });

const plan = (records: Record<string, string>[], existing: ExistingSourceNote[] = []) =>
  planRefresh({ source, sourcePath: 'sources/Feed.md', records, existing });

describe('notePathFor', () => {
  it.each([
    ['a b', 'a-b'],
    ['a/b', 'a-b'],
    ['a\u0000b', 'a-b'],
    ['東京', 'record'],
    ['..', 'record'],
  ])('gives %j a path of its own, not the one %j already has', (key, clashing) => {
    expect(pathFor(key)).not.toBe(pathFor(clashing));
  });

  it('keeps the filename short enough for a filesystem to hold', () => {
    const filename = pathFor('x'.repeat(5000)).split('/').at(-1) ?? '';
    expect(filename.length).toBeLessThanOrEqual(255);
  });

  it('stays inside the folder it was given', () => {
    expect(pathFor('a/../../b')).toMatch(/^imported\/[^/]+\.md$/);
  });
});

describe('planRefresh', () => {
  it('writes two records that differ only in punctuation to two notes', () => {
    const paths = plan([
      { id: 'acme corp', name: 'One' },
      { id: 'acme-corp', name: 'Two' },
    ]).writes.map((write) => write.path);

    expect(new Set(paths).size).toBe(2);
  });

  it('accounts for every existing note, even when two share a key', () => {
    const existing: ExistingSourceNote[] = [
      { path: 'imported/one.md', key: 'k', digest: 'garbage', body: 'yours' },
      { path: 'imported/two.md', key: 'k', digest: 'garbage', body: 'yours' },
    ];
    const { writes, missing } = plan([{ id: 'k', name: 'Name' }], existing);

    const accounted = new Set([...writes.map((write) => write.path), ...missing]);
    expect(accounted).toEqual(new Set(['imported/one.md', 'imported/two.md']));
  });

  it('writes the last record of a feed that is exactly as long as it may be', () => {
    const records = Array.from({ length: MAX_RECORDS }, (_unused, at) => ({
      id: `r${at}`,
      name: `Record ${at}`,
    }));
    const { writes, truncated } = plan(records);

    expect({ written: writes.length, truncated }).toEqual({
      written: MAX_RECORDS,
      truncated: false,
    });
  });
});
