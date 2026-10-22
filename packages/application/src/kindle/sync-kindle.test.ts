import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeKindleSync, KINDLE_MAX_PAGES_PER_BOOK } from '@dfai/domain';
import {
  fakeKindleDelay,
  fakeKindleNotebook,
  fakeKindleSink,
  heldKindleDelay,
  kindlePage,
} from '../testing/fake-kindle.ts';
import { KindleFetchError } from './ports.ts';
import { KINDLE_MIN_FETCH_GAP_MS, createKindleSync } from './sync-kindle.ts';

/*
 * The sync over a fake notebook and a fake sink standing in for #503's
 * source notes. The pages are the domain's hand-made fixtures, or built
 * here in the same shape; the books are public domain.
 */

// One per file, as the app has one (ADR-0044); its deadline never passes here.
const syncKindle = createKindleSync({ deadline: heldKindleDelay() });

const fixture = (name: string) =>
  readFileSync(new URL(`../../../domain/src/kindle/fixtures/${name}`, import.meta.url), 'utf8');

const NOW = Date.UTC(2026, 9, 21, 9, 0);
const clock = { now: () => NOW };
const delay = fakeKindleDelay();

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
    const report = await syncKindle({ source, sink, clock, delay });

    expect(report).toEqual({
      kind: 'synced',
      // Six of the first book: its five highlights and the note typed on the first.
      added: 7,
      books: [
        { kind: 'added', asin: 'B0EXAMPLE1', title: 'Pride and Prejudice', added: 6 },
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
      ['B0EXAMPLE1', 6, NOW],
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
    await syncKindle({ source: first, sink, clock, delay });
    const second = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one', 'two', 'three'])] },
    });

    const report = await syncKindle({ source: second, sink, clock, delay });

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
    expect(await syncKindle({ source, sink, clock, delay })).toMatchObject({
      kind: 'synced',
      added: 0,
    });
    expect(sink.writes).toEqual([]);
  });

  it('reports an empty library as synced with nothing new, asking for no book', async () => {
    const source = fakeKindleNotebook({ library: kindlePage(fixture('library-empty.html')) });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toEqual({
      kind: 'synced',
      books: [],
      added: 0,
    });
    expect(source.calls).toEqual([{ call: 'library' }]);
  });

  it('stops before any book when the library asks to sign in', async () => {
    const source = fakeKindleNotebook({ library: kindlePage(fixture('sign-in.html')) });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock, delay })).toEqual({
      kind: 'sign_in_required',
      books: [],
      added: 0,
    });
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
    expect(await syncKindle({ source, sink, clock, delay })).toEqual({
      kind: 'sign_in_required',
      books: [{ kind: 'added', asin: 'B0EXAMPLE1', title: 'Book B0EXAMPLE1', added: 1 }],
      added: 1,
    });
    expect(sink.writes.map((write) => write.book.asin)).toEqual(['B0EXAMPLE1']);
    expect(source.calls).not.toContainEqual(expect.objectContaining({ asin: 'B0EXAMPLE3' }));
  });

  it('says the page changed when the library is not the shape it knows, and writes nothing', async () => {
    const source = fakeKindleNotebook({ library: kindlePage(fixture('unrecognised.html')) });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock, delay })).toEqual({
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
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toEqual({
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
    const report = await syncKindle({ source, sink, clock, delay });
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

  it('writes nothing of a book whose page the host could not bring back, and stops there', async () => {
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
    const report = await syncKindle({ source, sink, clock, delay });
    expect(report).toEqual({
      kind: 'unavailable',
      message: 'timed out after 30 s',
      books: [],
      added: 0,
    });
    expect(sink.writes).toEqual([]);
    expect(
      source.calls.some((call) => call.call === 'annotations' && call.asin === 'B0EXAMPLE2'),
    ).toBe(false);
  });

  it('reports a book Amazon answered with an error status as unavailable, by its status', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [{ status: 503, html: '', redirectedTo: null }] },
    });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toMatchObject({
      books: [{ kind: 'unavailable', message: 'Amazon answered 503' }],
    });
  });

  it('reports the library the host could not reach, or Amazon refused, as unavailable', async () => {
    for (const kind of ['unreachable', 'timeout'] as const) {
      const unreachable = fakeKindleNotebook({ library: new KindleFetchError(kind, 'no answer') });
      expect(
        await syncKindle({ source: unreachable, sink: fakeKindleSink(), clock, delay }),
      ).toEqual({ kind: 'unavailable', message: 'no answer', books: [], added: 0 });
    }
    const refused = fakeKindleNotebook({ library: { status: 500, html: '', redirectedTo: null } });
    expect(await syncKindle({ source: refused, sink: fakeKindleSink(), clock, delay })).toEqual({
      kind: 'unavailable',
      message: 'Amazon answered 500',
      books: [],
      added: 0,
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
    expect(await syncKindle({ source, sink, clock, delay })).toEqual({
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
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toEqual({
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
    const report = await syncKindle({ source, sink, clock, delay });
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
    expect(await syncKindle({ source, sink, clock, delay })).toMatchObject({
      books: [{ kind: 'not_written', message: 'disk full' }],
    });
  });

  it('lets a failure that is not the host’s through, rather than calling it Amazon', async () => {
    const source = {
      fetchLibrary: () => Promise.reject(new TypeError('a bug')),
      fetchAnnotations: () => Promise.reject(new TypeError('a bug')),
    };
    await expect(syncKindle({ source, sink: fakeKindleSink(), clock, delay })).rejects.toThrow(
      'a bug',
    );
  });
});

describe('syncKindle when the host cannot bring a page', () => {
  const unsupported = new KindleFetchError('unsupported', 'Kindle sync needs macOS 14 or later');
  const notConnected = new KindleFetchError('not_connected', 'Kindle is not connected on this Mac');

  it('stops at once on a Mac that cannot keep the session apart, in the host’s words, and not as Amazon being down', async () => {
    const source = fakeKindleNotebook({ library: unsupported });
    const report = await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    expect(report).toEqual({
      kind: 'unsupported',
      message: 'Kindle sync needs macOS 14 or later',
      books: [],
      added: 0,
    });
    expect(describeKindleSync(report).message).not.toMatch(/try again later/);
  });

  it('stops at once when the library finds Kindle not connected', async () => {
    const source = fakeKindleNotebook({ library: notConnected });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toEqual({
      kind: 'not_connected',
      books: [],
      added: 0,
    });
    expect(source.calls).toEqual([{ call: 'library' }]);
  });

  it('stops with its own report when a session is lost mid-sync, keeping the books already added and asking for no more', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3'),
      books: {
        B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one'])],
        B0EXAMPLE2: [notConnected],
        B0EXAMPLE3: [annotationsOf('B0EXAMPLE3', ['three'])],
      },
    });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock, delay })).toEqual({
      kind: 'not_connected',
      books: [{ kind: 'added', asin: 'B0EXAMPLE1', title: 'Book B0EXAMPLE1', added: 1 }],
      added: 1,
    });
    expect(source.calls.filter((call) => call.call === 'annotations')).toHaveLength(2);
    expect(sink.writes.map((write) => write.book.asin)).toEqual(['B0EXAMPLE1']);
  });

  it('stops mid-sync on an unsupported Mac the same way', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2'),
      books: { B0EXAMPLE1: [unsupported], B0EXAMPLE2: [annotationsOf('B0EXAMPLE2', ['two'])] },
    });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toMatchObject({
      kind: 'unsupported',
      books: [],
    });
    expect(source.calls.filter((call) => call.call === 'annotations')).toHaveLength(1);
  });

  it('calls only an unreachable or timed-out host, or a 5xx, Amazon being unavailable', async () => {
    for (const kind of ['unreachable', 'timeout'] as const) {
      const source = fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1'),
        books: { B0EXAMPLE1: [new KindleFetchError(kind, 'no answer')] },
      });
      expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toEqual({
        kind: 'unavailable',
        message: 'no answer',
        books: [],
        added: 0,
      });
    }
  });

  it('reads a host that refused, a page too large and an answer it cannot read as a page it cannot read', async () => {
    for (const kind of ['refused', 'too_large', 'malformed'] as const) {
      const library = fakeKindleNotebook({
        library: new KindleFetchError(kind, `host said ${kind}`),
      });
      expect(await syncKindle({ source: library, sink: fakeKindleSink(), clock, delay })).toEqual({
        kind: 'unrecognised',
        reason: `host said ${kind}`,
      });
      const book = fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1'),
        books: { B0EXAMPLE1: [new KindleFetchError(kind, `host said ${kind}`)] },
      });
      expect(await syncKindle({ source: book, sink: fakeKindleSink(), clock, delay })).toEqual({
        kind: 'unrecognised',
        reason: `host said ${kind}`,
      });
    }
  });
});

describe('syncKindle when Amazon asks for more than a sign-in', () => {
  const robotCheck = {
    status: 302,
    html: '',
    redirectedTo: 'https://www.amazon.com/errors/validateCaptcha',
  };

  it('stops at once on a robot check with its own kind, keeping the books already added', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3'),
      books: {
        B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one'])],
        B0EXAMPLE2: [robotCheck],
        B0EXAMPLE3: [annotationsOf('B0EXAMPLE3', ['three'])],
      },
    });
    const report = await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    expect(report).toEqual({
      kind: 'robot_check',
      books: [{ kind: 'added', asin: 'B0EXAMPLE1', title: 'Book B0EXAMPLE1', added: 1 }],
      added: 1,
    });
    expect(describeKindleSync(report).message).toMatch(/robot/i);
    expect(source.calls).not.toContainEqual(expect.objectContaining({ asin: 'B0EXAMPLE3' }));
  });

  it('stops on a robot check at the library', async () => {
    const source = fakeKindleNotebook({ library: robotCheck });
    expect(await syncKindle({ source, sink: fakeKindleSink(), clock, delay })).toEqual({
      kind: 'robot_check',
      books: [],
      added: 0,
    });
  });

  it('names the store when the notebook is sent to another one, rather than say the page changed', async () => {
    const source = fakeKindleNotebook({
      library: { status: 302, html: '', redirectedTo: 'https://read.amazon.co.uk/notebook' },
    });
    const report = await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    expect(report).toEqual({
      kind: 'unsupported_store',
      store: 'read.amazon.co.uk',
      books: [],
      added: 0,
    });
    expect(describeKindleSync(report).message).toContain('read.amazon.co.uk');
  });
});

describe('syncKindle and notes typed later', () => {
  const withNote = (asin: string, quote: string, note: string | null) =>
    kindlePage(
      `<input id="kp-notebook-annotations-asin" value="${asin}"><div id="kp-notebook-annotations"><div id="ID-${asin}-one" class="a-row a-spacing-base"><span id="highlight">${quote}</span>${
        note === null ? '' : `<span id="note">${note}</span>`
      }</div></div>`,
    );
  const syncPage = async (
    sink: ReturnType<typeof fakeKindleSink>,
    page: ReturnType<typeof kindlePage>,
  ) =>
    syncKindle({
      source: fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1'),
        books: { B0EXAMPLE1: [page] },
      }),
      sink,
      clock,
      delay,
    });

  it('appends a note typed on a synced highlight after it, once, and never the highlight again', async () => {
    const sink = fakeKindleSink();
    await syncPage(sink, withNote('B0EXAMPLE1', 'Reader, I married him.', null));
    await syncPage(sink, withNote('B0EXAMPLE1', 'Reader, I married him.', 'The famous line.'));
    await syncPage(sink, withNote('B0EXAMPLE1', 'Reader, I married him.', 'The famous line.'));
    const written = sink.writes.flatMap((write) => write.highlights);
    expect(written.map((h) => [h.style, h.quote, h.note, h.commentOn])).toEqual([
      ['highlight', 'Reader, I married him.', null, null],
      ['note', '', 'The famous line.', 'amazon:ID-B0EXAMPLE1-one'],
    ]);
  });

  it('appends an edited note as a further comment, and never duplicates the highlight', async () => {
    const sink = fakeKindleSink();
    await syncPage(sink, withNote('B0EXAMPLE1', 'Reader, I married him.', 'First thought'));
    await syncPage(sink, withNote('B0EXAMPLE1', 'Reader, I married him.', 'Second thought'));
    const written = sink.writes.flatMap((write) => write.highlights);
    expect(written.map((h) => h.note ?? h.quote)).toEqual([
      'Reader, I married him.',
      'First thought',
      'Second thought',
    ]);
  });
});

describe('syncKindle and ids that clash across pages', () => {
  it('refuses a book whose later page gives another passage an id an earlier page used', async () => {
    const pageOf = (quote: string, token: string) =>
      kindlePage(
        `<input class="kp-notebook-annotations-next-page-start" value="${token}"><div id="kp-notebook-annotations"><div id="IDCLASHING01" class="a-row a-spacing-base"><span id="highlight">${quote}</span></div></div>`,
      );
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: {
        B0EXAMPLE1: [
          pageOf('It was the best of times.', 'T2'),
          pageOf('It was the worst of times.', ''),
        ],
      },
    });
    const sink = fakeKindleSink();
    expect(await syncKindle({ source, sink, clock, delay })).toEqual({
      kind: 'unrecognised',
      reason: 'two different annotations share one id',
    });
    expect(sink.writes).toEqual([]);
  });
});

describe('syncKindle at the pace of a person', () => {
  const twoBooks = () =>
    fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2'),
      books: {
        B0EXAMPLE1: [
          annotationsOf('B0EXAMPLE1', ['one'], 'T2'),
          annotationsOf('B0EXAMPLE1', ['two']),
        ],
        B0EXAMPLE2: [annotationsOf('B0EXAMPLE2', ['three'])],
      },
    });

  it('waits the minimum gap between fetches, and not before the first', async () => {
    let now = NOW;
    const pacing = fakeKindleDelay({ onWait: (milliseconds) => (now += milliseconds) });
    const report = await syncKindle({
      source: twoBooks(),
      sink: fakeKindleSink(),
      clock: { now: () => now },
      delay: pacing,
    });
    expect(report).toMatchObject({ kind: 'synced', added: 3 });
    // library, two pages of a book, one of the other: four fetches, three gaps.
    expect(pacing.waits).toEqual([
      KINDLE_MIN_FETCH_GAP_MS,
      KINDLE_MIN_FETCH_GAP_MS,
      KINDLE_MIN_FETCH_GAP_MS,
    ]);
  });

  it('waits for nothing when the gap has already passed, as on a slow Mac', async () => {
    let now = NOW;
    const pacing = fakeKindleDelay();
    await syncKindle({
      source: twoBooks(),
      sink: fakeKindleSink(),
      // Each look at the clock is two gaps later than the last.
      clock: { now: () => (now += 2 * KINDLE_MIN_FETCH_GAP_MS) },
      delay: pacing,
    });
    expect(pacing.waits).toEqual([]);
  });

  it('waits only what is left of the gap', async () => {
    let now = NOW;
    const pacing = fakeKindleDelay();
    await syncKindle({
      source: twoBooks(),
      sink: fakeKindleSink(),
      // A second passes between one fetch finishing and the next being asked for.
      clock: { now: () => (now += 1000) },
      delay: pacing,
    });
    expect(pacing.waits.length).toBeGreaterThan(0);
    expect(new Set(pacing.waits)).toEqual(new Set([KINDLE_MIN_FETCH_GAP_MS - 1000]));
  });
});

describe('syncKindle run twice at once', () => {
  it('joins the second call to the first: one sync runs, and both hear its report', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [annotationsOf('B0EXAMPLE1', ['one'])] },
    });
    const other = fakeKindleNotebook({ library: libraryOf('B0EXAMPLE2') });
    const sink = fakeKindleSink();
    const [first, second] = await Promise.all([
      syncKindle({ source, sink, clock, delay }),
      syncKindle({ source: other, sink, clock, delay }),
    ]);
    expect(second).toBe(first);
    expect(other.calls).toEqual([]);
    expect(sink.writes).toHaveLength(1);
  });

  it('runs again once the first has finished, even if it failed', async () => {
    const sink = fakeKindleSink();
    const broken = {
      fetchLibrary: () => Promise.reject(new TypeError('a bug')),
      fetchAnnotations: () => Promise.reject(new TypeError('a bug')),
    };
    await expect(syncKindle({ source: broken, sink, clock, delay })).rejects.toThrow('a bug');
    const source = fakeKindleNotebook({ library: libraryOf() });
    expect(await syncKindle({ source, sink, clock, delay })).toMatchObject({ kind: 'synced' });
  });
});
