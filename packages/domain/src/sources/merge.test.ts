import { describe, expect, it } from 'vitest';
import { InvalidVaultPathError } from '../vault/vault-path.ts';
import { parseDatasource, SOURCE_MISSING_KEY, type Datasource } from './datasource.ts';
import {
  digestOf,
  missingProperties,
  notePathFor,
  planRefresh,
  type ExistingSourceNote,
} from './merge.ts';

const source = (extra: Record<string, unknown> = {}): Datasource => {
  const parsed = parseDatasource({
    atlas: 'source',
    format: 'csv',
    file: 'feed.csv',
    into: 'imported',
    type: 'row',
    key: 'id',
    name: 'name',
    ...extra,
  });
  if (parsed === null) throw new Error('the test asked for a source that does not parse');
  return parsed;
};

const plan = (args: {
  source?: Datasource;
  records: Record<string, string>[];
  existing?: ExistingSourceNote[];
}) =>
  planRefresh({
    source: args.source ?? source(),
    sourcePath: 'sources/Feed.md',
    records: args.records,
    existing: args.existing ?? [],
  });

describe('digestOf', () => {
  it('gives the same text the same digest', () => {
    expect(digestOf('hello')).toBe(digestOf('hello'));
  });

  it('gives different text a different digest', () => {
    expect(digestOf('hello')).not.toBe(digestOf('hello.'));
  });

  it('has a digest for nothing', () => {
    expect(digestOf('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('notePathFor', () => {
  it('puts the note in the folder, named after its key', () => {
    expect(notePathFor({ into: 'imported', key: 'abc' })).toBe('imported/abc.md');
  });

  // Replacing is lossy, so a replaced key keeps a digest of itself: without one
  // `etc/passwd`, `etc passwd` and `etc-passwd` would all be the same note.
  it('replaces anything a path would take badly', () => {
    expect(notePathFor({ into: 'imported', key: '../../etc/passwd' })).toMatch(
      /^imported\/etc-passwd-[0-9a-f]{8}\.md$/,
    );
  });

  it('replaces the characters in a calendar UID', () => {
    expect(notePathFor({ into: 'cal', key: '1234@example.com' })).toMatch(
      /^cal\/1234-example\.com-[0-9a-f]{8}\.md$/,
    );
  });

  it('names a note whose key is all punctuation rather than leaving it blank', () => {
    expect(notePathFor({ into: 'cal', key: '///' })).toMatch(/^cal\/record-[0-9a-f]{8}\.md$/);
  });

  it('does not double the separator', () => {
    expect(notePathFor({ into: 'imported/', key: 'a' })).toBe('imported/a.md');
  });

  it('refuses a folder that would write outside the vault', () => {
    expect(() => notePathFor({ into: '../../..', key: 'a' })).toThrow(InvalidVaultPathError);
  });

  it('gives the same key the same path every time', () => {
    expect(notePathFor({ into: 'imported', key: 'acme corp' })).toBe(
      notePathFor({ into: 'imported', key: 'acme corp' }),
    );
  });
});

describe('planRefresh', () => {
  it('creates a note for a record it has not seen', () => {
    const { writes } = plan({ records: [{ id: '1', name: 'First' }] });
    expect(writes).toEqual([
      {
        kind: 'create',
        path: 'imported/1.md',
        properties: {
          type: 'row',
          title: 'First',
          atlas_source: 'sources/Feed.md',
          atlas_source_key: '1',
          atlas_source_digest: digestOf(''),
          atlas_source_missing: null,
        },
        body: '',
      },
    ]);
  });

  it('writes the mapped fields as properties', () => {
    const { writes } = plan({
      source: source({ map: { due_on: 'due' } }),
      records: [{ id: '1', name: 'First', due_on: '2026-09-20' }],
    });
    expect(writes[0]?.properties).toMatchObject({ due: '2026-09-20' });
  });

  it('leaves out a mapped field the record does not have', () => {
    const { writes } = plan({
      source: source({ map: { due_on: 'due' } }),
      records: [{ id: '1', name: 'First' }],
    });
    expect(writes[0]?.properties).not.toHaveProperty('due');
  });

  it('writes a field as the body when the source names one', () => {
    const { writes } = plan({
      source: source({ body: 'notes' }),
      records: [{ id: '1', name: 'First', notes: 'What happened.' }],
    });
    expect(writes[0]).toMatchObject({ body: 'What happened.' });
  });

  it('names a note after its key when it has no name', () => {
    const { writes } = plan({ records: [{ id: '1' }] });
    expect(writes[0]?.properties).toMatchObject({ title: '1' });
  });

  it('counts a record with no key rather than writing it somewhere arbitrary', () => {
    const planned = plan({
      records: [
        { id: '', name: 'Nameless' },
        { id: '1', name: 'Fine' },
      ],
    });
    expect(planned.unkeyed).toBe(1);
    expect(planned.writes).toHaveLength(1);
  });

  it('keeps the first of two records sharing a key', () => {
    const { writes } = plan({
      records: [
        { id: '1', name: 'First' },
        { id: '1', name: 'Second' },
      ],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.properties).toMatchObject({ title: 'First' });
  });

  it('replaces a note whose body it wrote itself', () => {
    const body = 'What happened.';
    const { writes } = plan({
      source: source({ body: 'notes' }),
      records: [{ id: '1', name: 'First', notes: 'What happened, revised.' }],
      existing: [{ path: 'imported/1.md', key: '1', digest: digestOf(body), body }],
    });
    expect(writes[0]).toMatchObject({
      kind: 'replace',
      path: 'imported/1.md',
      body: 'What happened, revised.',
    });
  });

  it('keeps a body you have edited, and refreshes only the properties', () => {
    const { writes } = plan({
      source: source({ body: 'notes', map: { due_on: 'due' } }),
      records: [{ id: '1', name: 'First', notes: 'From the feed.', due_on: '2026-09-21' }],
      existing: [
        {
          path: 'imported/1.md',
          key: '1',
          digest: digestOf('From the feed.'),
          body: 'From the feed. And my own thoughts.',
        },
      ],
    });
    expect(writes[0]).toMatchObject({ kind: 'properties', path: 'imported/1.md' });
    expect(writes[0]?.properties).toMatchObject({ due: '2026-09-21', title: 'First' });
  });

  it('does not restamp the digest on a note you have edited', () => {
    const { writes } = plan({
      source: source({ body: 'notes' }),
      records: [{ id: '1', name: 'First', notes: 'From the feed.' }],
      existing: [
        { path: 'imported/1.md', key: '1', digest: digestOf('From the feed.'), body: 'Mine now.' },
      ],
    });
    expect(writes[0]?.properties).not.toHaveProperty('atlas_source_digest');
  });

  it('reports a note whose record has gone, rather than deleting it', () => {
    const planned = plan({
      records: [{ id: '2', name: 'Still here' }],
      existing: [{ path: 'imported/1.md', key: '1', digest: digestOf(''), body: '' }],
    });
    expect(planned.missing).toEqual(['imported/1.md']);
    expect(planned.writes.every((write) => write.path !== 'imported/1.md')).toBe(true);
  });

  it('reports nothing missing when every note still has its record', () => {
    const planned = plan({
      records: [{ id: '1', name: 'First' }],
      existing: [{ path: 'imported/1.md', key: '1', digest: digestOf(''), body: '' }],
    });
    expect(planned.missing).toEqual([]);
  });

  // The mark is written by one refresh and has to be taken off by another, or
  // a note that was away for a day is hidden by every view filtering on it.
  it('clears the missing mark on a note whose record is back in the feed', () => {
    const { writes } = plan({
      records: [{ id: '1', name: 'First' }],
      existing: [{ path: 'imported/1.md', key: '1', digest: digestOf(''), body: '' }],
    });
    expect(writes[0]?.properties).toMatchObject({ [SOURCE_MISSING_KEY]: null });
  });

  it('clears the missing mark on a note whose body you have edited', () => {
    const { writes } = plan({
      source: source({ body: 'notes' }),
      records: [{ id: '1', name: 'First', notes: 'From the feed.' }],
      existing: [
        { path: 'imported/1.md', key: '1', digest: digestOf('From the feed.'), body: 'Mine now.' },
      ],
    });
    expect(writes[0]).toMatchObject({ kind: 'properties' });
    expect(writes[0]?.properties).toMatchObject({ [SOURCE_MISSING_KEY]: null });
  });

  it('clears the missing mark on a note it creates, which nothing has marked', () => {
    const { writes } = plan({ records: [{ id: '1', name: 'First' }] });
    expect(writes[0]?.properties).toMatchObject({ [SOURCE_MISSING_KEY]: null });
  });

  // `source: you` is what this vault's own board writes on a task, and a note
  // a refresh touches must not have that meaning rewritten under it.
  it('keeps its bookkeeping under a namespace rather than on plain property names', () => {
    const { writes } = plan({ records: [{ id: '1', name: 'First' }] });
    const bookkeeping = Object.keys(writes[0]?.properties ?? {}).filter(
      (property) => property !== 'type' && property !== 'title',
    );
    expect(bookkeeping.every((property) => property.startsWith('atlas_'))).toBe(true);
  });

  it('stops at the record limit and says so', () => {
    const many = Array.from({ length: 2100 }, (_unused, at) => ({ id: String(at), name: 'x' }));
    const planned = plan({ records: many });
    expect(planned.writes).toHaveLength(2000);
    expect(planned.truncated).toBe(true);
  });

  it('does not claim to have truncated a feed that fit', () => {
    expect(plan({ records: [{ id: '1', name: 'a' }] }).truncated).toBe(false);
  });

  it('does not report the tail of a truncated feed as missing', () => {
    const many = Array.from({ length: 2100 }, (_unused, at) => ({ id: String(at), name: 'x' }));
    const planned = plan({
      records: many,
      existing: [{ path: 'imported/2050.md', key: '2050', digest: digestOf(''), body: '' }],
    });
    expect(planned.missing).toEqual([]);
  });

  it('never creates a note over a path an existing note holds', () => {
    // The feed renamed a key, so the record's own path is the one the note it
    // replaced still sits on.
    const existing: ExistingSourceNote[] = [
      { path: 'imported/2.md', key: 'renamed', digest: digestOf(''), body: '' },
    ];
    const { writes, missing } = plan({ records: [{ id: '2', name: 'Second' }], existing });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'create', path: 'imported/2-2.md' });
    expect(missing).toEqual(['imported/2.md']);
  });

  it('does not let a mapped field take a property the source owns', () => {
    const { writes } = plan({
      source: source({ map: { impostor: 'atlas_source_key' } }),
      records: [{ id: '1', name: 'First', impostor: 'not-the-key' }],
    });
    expect(writes[0]?.properties).toMatchObject({ atlas_source_key: '1' });
  });
});

describe('missingProperties', () => {
  it('marks a note rather than saying anything about deleting it', () => {
    expect(missingProperties()).toEqual({ [SOURCE_MISSING_KEY]: true });
  });
});
