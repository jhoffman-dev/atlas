import { describe, expect, it } from 'vitest';
import { parseDatasource } from './datasource.ts';
import { readSourceRequest, secretsUsedBy, sourceRequest } from './source-request.ts';

const URL = 'https://api.example.test/items';

describe('readSourceRequest', () => {
  it('reads no headers as none', () => {
    expect(readSourceRequest({ url: URL, headers: undefined, auth: undefined })).toEqual({});
  });

  it('reads headers whose values name secrets', () => {
    expect(
      readSourceRequest({
        url: URL,
        headers: { Authorization: 'Bearer {{secret:github}}', Accept: 'application/json' },
        auth: undefined,
      }),
    ).toEqual({ Authorization: 'Bearer {{secret:github}}', Accept: 'application/json' });
  });

  it('folds auth into a bearer Authorization header', () => {
    expect(readSourceRequest({ url: URL, headers: undefined, auth: { secret: 'github' } })).toEqual(
      { Authorization: 'Bearer {{secret:github}}' },
    );
  });

  it('takes another scheme when auth names one', () => {
    expect(
      readSourceRequest({ url: URL, headers: {}, auth: { secret: 'gh', scheme: 'token' } }),
    ).toEqual({ Authorization: 'token {{secret:gh}}' });
  });

  it('refuses auth beside an Authorization header, whatever its case', () => {
    expect(
      readSourceRequest({ url: URL, headers: { authorization: 'x' }, auth: { secret: 'gh' } }),
    ).toBeNull();
  });

  it('refuses auth without a usable secret name', () => {
    expect(readSourceRequest({ url: URL, headers: {}, auth: { secret: '' } })).toBeNull();
    expect(readSourceRequest({ url: URL, headers: {}, auth: 'github' })).toBeNull();
    expect(readSourceRequest({ url: URL, headers: {}, auth: { secret: 'a b' } })).toBeNull();
    expect(
      readSourceRequest({ url: URL, headers: {}, auth: { secret: 'gh', scheme: 'Two words' } }),
    ).toBeNull();
  });

  it('refuses a header name that could not be sent', () => {
    expect(readSourceRequest({ url: URL, headers: { 'X Bad': 'v' }, auth: null })).toBeNull();
    expect(readSourceRequest({ url: URL, headers: { 'X-Ok\n': 'v' }, auth: null })).toBeNull();
  });

  it('refuses headers that are not a map, or a value that is not text', () => {
    expect(readSourceRequest({ url: URL, headers: ['Accept'], auth: null })).toBeNull();
    expect(readSourceRequest({ url: URL, headers: { Accept: { a: 1 } }, auth: null })).toBeNull();
  });

  it('refuses a malformed reference in a header or in the URL', () => {
    expect(readSourceRequest({ url: URL, headers: { A: '{{secret:}}' }, auth: null })).toBeNull();
    expect(readSourceRequest({ url: `${URL}?k={{secret:key`, headers: {}, auth: null })).toBeNull();
  });

  it('refuses headers on a source that reads a file', () => {
    expect(readSourceRequest({ url: null, headers: { A: 'b' }, auth: null })).toBeNull();
    expect(readSourceRequest({ url: null, headers: {}, auth: null })).toEqual({});
  });
});

const fetched = (extra: Record<string, unknown>) =>
  parseDatasource({
    atlas: 'source',
    format: 'json',
    url: 'https://x.test/{{secret:path}}/feed',
    into: 'Items',
    type: 'item',
    ...extra,
  });

describe('sourceRequest', () => {
  it('splits the URL and every header into text and secret names', () => {
    const source = fetched({ auth: { secret: 'github' }, headers: { Accept: 'text/csv' } });
    expect(source).not.toBeNull();
    expect(source && sourceRequest(source)).toEqual({
      url: [{ text: 'https://x.test/' }, { secret: 'path' }, { text: '/feed' }],
      headers: [
        { name: 'Accept', value: [{ text: 'text/csv' }] },
        { name: 'Authorization', value: [{ text: 'Bearer ' }, { secret: 'github' }] },
      ],
    });
  });

  it('is nothing for a source that reads a file', () => {
    const source = parseDatasource({
      atlas: 'source',
      format: 'csv',
      file: 'a.csv',
      into: 'x',
      type: 'row',
    });
    expect(source).not.toBeNull();
    expect(source && sourceRequest(source)).toBeNull();
  });
});

describe('secretsUsedBy', () => {
  it('names every secret the URL and headers use, once each', () => {
    const source = fetched({ headers: { A: '{{secret:github}}', B: '{{secret:path}}' } });
    expect(source && secretsUsedBy(source)).toEqual(['path', 'github']);
  });
});
