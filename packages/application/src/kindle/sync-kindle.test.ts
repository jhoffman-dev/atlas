import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KINDLE_MAX_PAGES_PER_BOOK } from '@dfai/domain';
import { fakeKindleNotebook, fakeKindleSink, kindlePage } from '../testing/fake-kindle.ts';
import { KindleFetchError } from './ports.ts';
import { syncKindle } from './sync-kindle.ts';

/*
 * The sync over a fake notebook and a fake sink standing in for #503's
 * source notes. The pages are the domain's hand-made fixtures, or built
 * here in the same shape; the books are public domain.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../../domain/src/kindle/fixtures/${name}`, import.meta.url), 'utf8');

const NOW = Date.UTC(2026, 9, 21, 9, 0);
const clock = { now: () => NOW };

const libraryOf = (...asins: string[]) =>
  kindlePage(
    `<div id="kp-notebook-library">${asins
      .map(
        (asin) =>
          `<div id="${asin}" class="kp-notebook-library-each-book"><h2 class="kp-notebook-searchable">Book ${asin}</h2></div>`,
      )
      .join('')}</div>`,
  );

const annotationsOf = (asin: string, quotes: readonly string[], token = '') =>
  kindlePage(
    `<input class="kp-notebook-annotations-next-page-start" value="${token}"><input id="kp-notebook-annotations-asin" value="${asin}"><div id="kp-notebook-annotations">${quotes
      .map(
        (quote) =>
          `<div id="ID-${asin}-${quote}" class="a-row a-spacing-base"><span id="highlight">${quote}</span></div>`,
      )
      .join('')}</div>`,
  );

const keyOf = (asin: string, quote: string) => `amazon:ID-${asin}-${quote}`;

describe('syncKindle', () => {
  it('reads every book whole, across pages, and hands the sink its new highlights with the time', async () => {
    const source = fakeKindleNotebook({
      library: kindlePage(fixture('library.html')),
      books: {
        B0EXAMPLE1: [
          kindlePage(fixture('annotations-page-1.html')),
          kindlePage(fixture('annotations-page-2.html')),
        ],
        B0EXAMPLE2: [annotationsOf('B0EXAMPLE2', ['whale'])],
        B0EXAMPLE3: [annotationsOf('B0EXAMPLE3', [])],
      },
    });
    const sink = fakeKindleSink();
    const report = await syncKindle({ source, sink, clock });

    expect(report).toEqual({
      kind: 'synced',
      added: 6,
      books: [
        { kind: 'added', asin: 'B0EXAMPLE1', title: 'Pride and Prejudice', added: 5 },
        { kind: 'added', asin: 'B0EXAMPLE2', title: 'Moby-Dick; or, The Whale', added: 1 },
        {
          kind: 'added',
          asin: 'B0EXAMPLE3',
          title: 'Frankenstein; or, The Modern Prometheus',
          added: 0,
        },
      ],
    });
    expect(
      sink.writes.map((write) => [write.book.asin, write.highlights.length, write.syncedAt]),
    ).toEqual([
      ['B0EXAMPLE1', 5, NOW],
      ['B0EXAMPLE2', 1, NOW],
    ]);
    expect(sink.writes[0]?.highlights.at(-1)?.quote).toBe('Till this moment I never knew myself.');
    expect(source.calls).toContainEqual({
      call: 'annotations',
      asin: 'B0EXAMPLE1',
      cursor: { token: 'CgUIAhCeAg', contentLimitState: 'eyJjb250ZW50TGltaXQiOiJleGFtcGxlIn0' },
    });
  });

  it('adds only what the note has not recorded, so a second sync adds just the new highlight', async () => {
    const sink = fakeKindleSink();
    const first = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one', 'two'])] },
    });
    await syncKindle({ source: first, sink, clock });
    const second = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one', 'two', 'three'])] },
    });

    const report = await syncKindle({ source: second, sink, clock });

    expect(report).toMatchObject({ kind: 'synced', added: 1 });
    expect(sink.writes.map((write) => write.highlights.map((h) => h.quote))).toEqual([
      ['one', 'two'],
      ['three'],
    ]);
  });

  it('writes nothing for a book with nothing new', async () => {
    const sink = fakeKindleSink({ recorded: { B0EXAMPLE1: [keyOf('B0EXAMPLE1', 'one')] } });
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one'])] },
    });
    expect(await syncKindle({ source, sink, clock })).toMatchObject({ kind: 'synced', added: 0 });
    expect(sink.writes).toEqual([]);
  });

  it('reports an empty library as synced with nothing new, asking for no book', async () => {
    const source = fakeKindleNotebook({ library: kindlePage(fixture('library-empty.html')) });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock })).toEqual({
      kind: 'synced',
      books: [],
      added: 0,
    });
    expect(source.calls).toEqual([{ call: 'library' }]);
  });

  it('stops before any book when the library asks to sign in', async () => {
    const source = fakeKindleNotebook({ library: kindlePage(fixture('sign-in.html')) });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock })).toEqual({ kind: 'sign_in_required' });
    expect(source.calls).toEqual([{ call: 'library' }]);
  });

  it('stops where it is when a book’s page asks to sign in, keeping the books already written whole', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3'),
      books: {
        B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one'])],
        B0EXAMPLE2: [{ status: 302, html: '', redirectedTo: 'https://www.amazon.com/ap/signin' }],
        B0EXAMPLE3: [annotationsOf('B0EXAMPLE3', ['three'])],
      },
    });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock })).toEqual({ kind: 'sign_in_required' });
    expect(sink.writes.map((write) => write.book.asin)).toEqual(['B0EXAMPLE1']);
    expect(source.calls).not.toContainEqual(expect.objectContaining({ asin: 'B0EXAMPLE3' }));
  });

  it('says the page changed when the library is not the shape it knows, and writes nothing', async () => {
    const source = fakeKindleNotebook({ library: kindlePage(fixture('unrecognised.html')) });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock })).toEqual({
      kind: 'unrecognised',
      reason: 'the page has no library',
    });
    expect(sink.writes).toEqual([]);
  });

  it('says the page changed when every book’s pages are not the shape it knows', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2'),
      books: {
        B0EXAMPLE1: [kindlePage(fixture('unrecognised.html'))],
        B0EXAMPLE2: [kindlePage(fixture('unrecognised.html'))],
      },
    });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock })).toEqual({
      kind: 'unrecognised',
      reason: 'the page has no annotations',
    });
  });

  it('writes nothing of a book whose second page cannot be read, though its first could', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2'),
      books: {
        B0EXAMPLE1: [
          annotationsOf('B0EXAMPLE1', ['one'], 'T2'),
          kindlePage('<p>Something else entirely</p>'),
        ],
        B0EXAMPLE2: [annotationsOf('B0EXAMPLE2', ['two'])],
      },
    });
    const sink = fakeKindleSink();
    const report = await syncKindle({ source, sink, clock });
    expect(report).toEqual({
      kind: 'synced',
      added: 1,
      books: [
        {
          kind: 'unrecognised',
          asin: 'B0EXAMPLE1',
          title: 'Book B0EXAMPLE1',
          reason: 'the page has no annotations',
        },
        { kind: 'added', asin: 'B0EXAMPLE2', title: 'Book B0EXAMPLE2', added: 1 },
      ],
    });
    expect(sink.writes.map((write) => write.book.asin)).toEqual(['B0EXAMPLE2']);
  });

  it('writes nothing of a book whose page the host could not bring back, and goes on to the next', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2'),
      books: {
        B0EXAMPLE1: [
          annotationsOf('B0EXAMPLE1', ['one'], 'T2'),
          new KindleFetchError('timeout', 'timed out after 30 s'),
        ],
        B0EXAMPLE2: [annotationsOf('B0EXAMPLE2', ['two'])],
      },
    });
    const sink = fakeKindleSink();
    const report = await syncKindle({ source, sink, clock });
    expect(report).toMatchObject({
      kind: 'synced',
      books: [
        { kind: 'unavailable', asin: 'B0EXAMPLE1', message: 'timed out after 30 s' },
        { kind: 'added', asin: 'B0EXAMPLE2' },
      ],
    });
    expect(sink.writes.map((write) => write.book.asin)).toEqual(['B0EXAMPLE2']);
  });

  it('reports a book Amazon answered with an error status as unavailable, by its status', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [{ status: 503, html: '', redirectedTo: null }] },
    });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock })).toMatchObject({
      books: [{ kind: 'unavailable', message: 'Amazon answered 503' }],
    });
  });

  it('reports the library the host could not fetch, or Amazon refused, as unavailable', async () => {
    const unreachable = fakeKindleNotebook({
      library: new KindleFetchError('not_connected', 'Kindle is not connected'),
    });
    expect(await syncKindle({ source: unreachable, sink: fakeKindleSink(), clock })).toEqual({
      kind: 'unavailable',
      message: 'Kindle is not connected',
    });
    const refused = fakeKindleNotebook({ library: { status: 500, html: '', redirectedTo: null } });
    expect(await syncKindle({ source: refused, sink: fakeKindleSink(), clock })).toEqual({
      kind: 'unavailable',
      message: 'Amazon answered 500',
    });
  });

  it('refuses a book whose next-page token comes round again, rather than reading for ever', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: {
        B0EXAMPLE1: [
          annotationsOf('B0EXAMPLE1', ['one'], 'T2'),
          annotationsOf('B0EXAMPLE1', ['two'], 'T3'),
          annotationsOf('B0EXAMPLE1', ['three'], 'T2'),
        ],
      },
    });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock })).toEqual({
      kind: 'unrecognised',
      reason: 'the pages of the book go round in a circle',
    });
    expect(sink.writes).toEqual([]);
  });

  it('refuses a book of more pages than any book has, each with a new token', async () => {
    let page = 0;
    const source = {
      fetchLibrary: () => Promise.resolve(libraryOf('B0EXAMPLE1')),
      fetchAnnotations: () => {
        page += 1;
        return Promise.resolve(annotationsOf('B0EXAMPLE1', [`q${page}`], `T${page}`));
      },
    };
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock })).toEqual({
      kind: 'unrecognised',
      reason: `the book has more than ${KINDLE_MAX_PAGES_PER_BOOK} pages`,
    });
    expect(page).toBe(KINDLE_MAX_PAGES_PER_BOOK);
  });

  it('reports a book the sink could not read or write as not written, and goes on', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3'),
      books: {
        B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one'])],
        B0EXAMPLE2: [annotationsOf('B0EXAMPLE2', ['two'])],
        B0EXAMPLE3: [annotationsOf('B0EXAMPLE3', ['three'])],
      },
    });
    const sink = fakeKindleSink({
      failRead: new Set(['B0EXAMPLE1']),
      failWrite: new Set(['B0EXAMPLE2']),
    });
    const report = await syncKindle({ source, sink, clock });
    expect(report).toMatchObject({
      kind: 'synced',
      added: 1,
      books: [
        { kind: 'not_written', message: 'cannot read the note of Book B0EXAMPLE1' },
        { kind: 'not_written', message: 'cannot write the note of Book B0EXAMPLE2' },
        { kind: 'added', added: 1 },
      ],
    });
  });

  it('reports a sink that throws something other than an Error by what it threw', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one'])] },
    });
    const sink = {
      recordedKeys: () => Promise.resolve(new Set<string>()),
      addHighlights: () => Promise.reject('disk full'),
    };
    expect(await syncKindle({ source, sink, clock })).toMatchObject({
      books: [{ kind: 'not_written', message: 'disk full' }],
    });
  });

  it('lets a failure that is not the host’s through, rather than calling it Amazon', async () => {
    const source = {
      fetchLibrary: () => Promise.reject(new TypeError('a bug')),
      fetchAnnotations: () => Promise.reject(new TypeError('a bug')),
    };
    await expect(syncKindle({ source, sink: fakeKindleSink(), clock })).rejects.toThrow('a bug');
  });
});
