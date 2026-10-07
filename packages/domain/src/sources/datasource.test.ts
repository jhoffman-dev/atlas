import { describe, expect, it } from 'vitest';
import {
  isDatasource,
  parseDatasource,
  SOURCE_DIGEST_KEY,
  SOURCE_KEY_KEY,
  SOURCE_MISSING_KEY,
  SOURCE_PATH_KEY,
} from './datasource.ts';

const source = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  atlas: 'source',
  format: 'csv',
  file: 'data/feed.csv',
  into: 'imported',
  type: 'row',
  ...extra,
});

describe('isDatasource', () => {
  it('recognises a source', () => {
    expect(isDatasource({ atlas: 'source' })).toBe(true);
  });

  it('does not mistake a dashboard for one', () => {
    expect(isDatasource({ atlas: 'dashboard' })).toBe(false);
  });
});

describe('parseDatasource', () => {
  it('reads nothing from a note that is not a source', () => {
    expect(parseDatasource({ format: 'csv', file: 'a.csv', into: 'x', type: 'row' })).toBeNull();
  });

  it('reads a source that says enough to be usable', () => {
    expect(parseDatasource(source())).toMatchObject({
      format: 'csv',
      file: 'data/feed.csv',
      into: 'imported',
      type: 'row',
    });
  });

  it('refuses a format it cannot read', () => {
    expect(parseDatasource(source({ format: 'xml' }))).toBeNull();
  });

  it('refuses a source with nowhere to read from', () => {
    expect(parseDatasource({ atlas: 'source', format: 'csv', into: 'x', type: 'row' })).toBeNull();
  });

  it('refuses a source with nowhere to write to', () => {
    expect(parseDatasource(source({ into: undefined }))).toBeNull();
  });

  it('refuses a source that would write outside the vault', () => {
    expect(parseDatasource(source({ into: '../../elsewhere' }))).toBeNull();
  });

  it('refuses a source whose notes would have no type', () => {
    expect(parseDatasource(source({ type: '  ' }))).toBeNull();
  });

  it('reads a URL instead of a file', () => {
    expect(
      parseDatasource(source({ file: undefined, url: 'https://example.test/f.csv' })),
    ).toMatchObject({ url: 'https://example.test/f.csv', file: null });
  });

  it('refuses a source that declares two places to read from', () => {
    expect(parseDatasource(source({ url: 'https://example.test/f.csv' }))).toBeNull();
  });

  it('keys a calendar on UID and names it after its summary', () => {
    expect(parseDatasource(source({ format: 'ics' }))).toMatchObject({
      key: 'uid',
      name: 'summary',
    });
  });

  it('keys anything else on id and name', () => {
    expect(parseDatasource(source())).toMatchObject({ key: 'id', name: 'name' });
  });

  it('honours a key and name it is given', () => {
    expect(parseDatasource(source({ key: 'ref', name: 'label' }))).toMatchObject({
      key: 'ref',
      name: 'label',
    });
  });

  it('reads which field becomes which property', () => {
    expect(parseDatasource(source({ map: { due_on: 'due', owner: 'assignee' } }))?.map).toEqual({
      due_on: 'due',
      owner: 'assignee',
    });
  });

  it('drops a mapping with no property to write to', () => {
    expect(parseDatasource(source({ map: { due_on: '  ' } }))?.map).toEqual({});
  });

  it('reads no mapping when it is not a mapping', () => {
    expect(parseDatasource(source({ map: ['due'] }))?.map).toEqual({});
  });

  it('reads a refresh interval', () => {
    expect(parseDatasource(source({ interval: 30 }))?.interval).toBe(30);
  });

  it('reads an interval under a minute as only when asked', () => {
    expect(parseDatasource(source({ interval: 0.5 }))?.interval).toBe(0);
  });

  it('reads a missing interval as only when asked', () => {
    expect(parseDatasource(source())?.interval).toBe(0);
  });

  it('reads an interval that is not a number as only when asked', () => {
    expect(parseDatasource(source({ interval: 'hourly' }))?.interval).toBe(0);
  });
});

describe('the keys a refresh writes', () => {
  // `source: you` is this vault's own convention on every task, and a type is
  // free to map a field onto any name a source does not already own.
  it('are namespaced, so none of them is a name a vault may already use', () => {
    const keys = [SOURCE_PATH_KEY, SOURCE_KEY_KEY, SOURCE_DIGEST_KEY, SOURCE_MISSING_KEY];
    expect(keys.every((key) => key.startsWith('atlas_'))).toBe(true);
  });
});

describe('parseDatasource, SQLite', () => {
  const sqlite = (extra: Record<string, unknown> = {}) =>
    source({
      format: 'sqlite',
      file: 'data/app.db',
      query: 'SELECT id, name FROM items',
      ...extra,
    });

  it('reads a SQLite source with a file and a query', () => {
    expect(parseDatasource(sqlite())).toMatchObject({
      format: 'sqlite',
      file: 'data/app.db',
      query: 'SELECT id, name FROM items',
      key: 'id',
      name: 'name',
    });
  });

  it('reads one outside the vault by its absolute path', () => {
    expect(parseDatasource(sqlite({ file: '/Users/me/app.db' }))?.file).toBe('/Users/me/app.db');
  });

  it('refuses one without a query, or fetched from a URL', () => {
    expect(parseDatasource(sqlite({ query: '' }))).toBeNull();
    expect(parseDatasource(sqlite({ file: undefined, url: 'https://x.test/app.db' }))).toBeNull();
  });

  it('refuses a query on a source that is not SQLite', () => {
    expect(parseDatasource(source({ query: 'SELECT 1' }))).toBeNull();
  });

  it('refuses headers on a file it reads from disk', () => {
    expect(parseDatasource(sqlite({ auth: { secret: 'db' } }))).toBeNull();
  });
});

describe('parseDatasource, headers', () => {
  it('reads no headers as none', () => {
    expect(parseDatasource(source())?.headers).toEqual({});
  });

  it('refuses a fetched source whose header names a secret wrongly', () => {
    expect(
      parseDatasource(
        source({ file: undefined, url: 'https://x.test', headers: { A: '{{secret: }}' } }),
      ),
    ).toBeNull();
  });
});
