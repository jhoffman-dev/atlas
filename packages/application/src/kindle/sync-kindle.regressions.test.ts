import { describe, expect, it } from 'vitest';
import { describeKindleSync } from '@dfai/domain';
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
 * Regressions found in review of PR #511: the sync under orders and answers it was not written
 * for. The books are invented; the quotes are public domain.
 */

// One per file, as the app has one (ADR-0044); its deadline never passes here.
const syncKindle = createKindleSync({ deadline: heldKindleDelay() });

const NOW = Date.UTC(2026, 9, 21, 9, 0);
const HOUR = 60 * 60 * 1000;
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

const bookPage = (asin: string, rows: string) =>
  kindlePage(
    `<input id="kp-notebook-annotations-asin" value="${asin}"><div id="kp-notebook-annotations">${rows}</div>`,
  );

const highlightRow = (id: string, quote: string, note?: string) =>
  `<div id="${id}" class="a-row a-spacing-base"><span id="highlight">${quote}</span>${
    note === undefined ? '' : `<span id="note">${note}</span>`
  }</div>`;

const noteRow = (id: string, note: string) =>
  `<div id="${id}" class="a-row a-spacing-base"><span id="note">${note}</span></div>`;

describe('syncKindle under orders it was not written for', () => {
  it('adds each highlight once when two syncs run at the same time', async () => {
    const page = bookPage('B0EXAMPLE1', highlightRow('IDCONCURRENT1', 'Call me Ishmael.'));
    const source = () =>
      fakeKindleNotebook({ library: libraryOf('B0EXAMPLE1'), books: { B0EXAMPLE1: [page] } });
    const sink = fakeKindleSink();
    // The sync on launch and the one from ⌘K, say: both read the note before either writes.
    await Promise.all([
      syncKindle({ source: source(), sink, clock, delay }),
      syncKindle({ source: source(), sink, clock, delay }),
    ]);
    const written = sink.writes.flatMap((write) => write.highlights.map((h) => h.key));
    expect(written).toEqual(['amazon:IDCONCURRENT1']);
  });

  it('brings in a note typed on a highlight after the highlight was synced', async () => {
    const sink = fakeKindleSink();
    const before = bookPage('B0EXAMPLE1', highlightRow('IDNOTELATER1', 'Reader, I married him.'));
    await syncKindle({
      source: fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1'),
        books: { B0EXAMPLE1: [before] },
      }),
      sink,
      clock,
      delay,
    });
    const after = bookPage(
      'B0EXAMPLE1',
      highlightRow('IDNOTELATER1', 'Reader, I married him.', 'The famous last chapter.'),
    );
    await syncKindle({
      source: fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1'),
        books: { B0EXAMPLE1: [after] },
      }),
      sink,
      clock,
      delay,
    });
    const notes = sink.writes.flatMap((write) => write.highlights.map((h) => h.note));
    expect(notes).toContain('The famous last chapter.');
  });

  it('does not tell a Mac that was never connected that it will try again later', async () => {
    const source = fakeKindleNotebook({
      library: new KindleFetchError('not_connected', 'Kindle is not connected on this Mac'),
    });
    const report = await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    expect(describeKindleSync(report).message).not.toMatch(/try again later/);
  });

  it('stops at the first book when the session is gone mid-sync, rather than asking for every other book', async () => {
    const asins = ['B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3', 'B0EXAMPLE4'];
    const gone = new KindleFetchError('not_connected', 'Kindle is not connected on this Mac');
    const source = fakeKindleNotebook({
      library: libraryOf(...asins),
      books: Object.fromEntries(asins.map((asin) => [asin, [gone]])),
    });
    await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    const asked = source.calls.filter((call) => call.call === 'annotations').length;
    expect(asked).toBe(1);
  });
});

/*
 * Verification of PR #511 after its fix round: the sync against clocks, networks and notes the
 * fixes were not tested with.
 */
describe('syncKindle against clocks, networks and notes the fix round did not try', () => {
  it('never waits longer than the fetch gap when the clock is set back mid-sync', async () => {
    // Readings: the slot's start, then the library fetch ending; after that the Mac's clock is
    // corrected back an hour, so the next fetch reads as an hour before the last one ended.
    let readings = 0;
    const steppedBack = { now: () => (readings++ < 2 ? NOW : NOW - HOUR) };
    const pacing = fakeKindleDelay();
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: {
        B0EXAMPLE1: [bookPage('B0EXAMPLE1', highlightRow('IDCLOCKBACK1', 'Call me Ishmael.'))],
      },
    });
    await syncKindle({ source, sink: fakeKindleSink(), clock: steppedBack, delay: pacing });
    expect(Math.max(0, ...pacing.waits)).toBeLessThanOrEqual(KINDLE_MIN_FETCH_GAP_MS);
    expect(pacing.waits).toEqual([KINDLE_MIN_FETCH_GAP_MS]);
  });

  it('stops asking for books once the host cannot reach Amazon, rather than timing out on every one', async () => {
    // The Wi-Fi drops after the library: each further fetch is a 30 s host timeout.
    const asins = ['B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3', 'B0EXAMPLE4', 'B0EXAMPLE5'];
    const lost = new KindleFetchError('timeout', 'timed out after 30 s');
    const source = fakeKindleNotebook({
      library: libraryOf(...asins),
      books: Object.fromEntries(asins.map((asin) => [asin, [lost]])),
    });
    await syncKindle({ source, sink: fakeKindleSink(), clock, delay: fakeKindleDelay() });
    const asked = source.calls.filter((call) => call.call === 'annotations').length;
    expect(asked).toBe(1);
  });

  it('reports a host that stopped answering mid-sync as unavailable, with the books it had added', async () => {
    for (const kind of ['timeout', 'unreachable'] as const) {
      const source = fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3'),
        books: {
          B0EXAMPLE1: [bookPage('B0EXAMPLE1', highlightRow('IDBEFORELOST', 'Call me Ishmael.'))],
          B0EXAMPLE2: [new KindleFetchError(kind, 'no answer')],
          B0EXAMPLE3: [
            bookPage('B0EXAMPLE3', highlightRow('IDAFTERLOST1', 'Reader, I married him.')),
          ],
        },
      });
      const report = await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
      expect(report, kind).toEqual({
        kind: 'unavailable',
        message: 'no answer',
        books: [
          { kind: 'added', asin: 'B0EXAMPLE1', title: 'Book B0EXAMPLE1', added: 1, unplaced: [] },
        ],
        added: 1,
      });
      expect(describeKindleSync(report).message, kind).toMatch(
        /Before it stopped, 1 highlight was added/,
      );
    }
  });

  it('brings in the new words of a note (with no passage) edited after it was synced', async () => {
    const sink = fakeKindleSink();
    const syncWith = (note: string) =>
      syncKindle({
        source: fakeKindleNotebook({
          library: libraryOf('B0EXAMPLE1'),
          books: { B0EXAMPLE1: [bookPage('B0EXAMPLE1', noteRow('IDSTANDALONE1', note))] },
        }),
        sink,
        clock,
        delay: fakeKindleDelay(),
      });
    await syncWith('A first thought on the opening.');
    await syncWith('A better thought on the opening.');
    const notes = sink.writes.flatMap((write) => write.highlights.map((h) => h.note));
    expect(notes).toContain('A better thought on the opening.');
  });

  it('adds a note (with no passage) once however often it is synced unedited', async () => {
    const sink = fakeKindleSink();
    for (let round = 0; round < 3; round += 1) {
      await syncKindle({
        source: fakeKindleNotebook({
          library: libraryOf('B0EXAMPLE1'),
          books: {
            B0EXAMPLE1: [bookPage('B0EXAMPLE1', noteRow('IDSTANDALONE2', 'A thought, kept.'))],
          },
        }),
        sink,
        clock,
        delay,
      });
    }
    const notes = sink.writes.flatMap((write) => write.highlights.map((h) => h.note));
    expect(notes).toEqual(['A thought, kept.']);
  });

  it('hands a sync that failed to every caller that joined it, and lets the next one run afresh', async () => {
    const sink = fakeKindleSink();
    const broken = {
      fetchLibrary: () => Promise.reject(new Error('the host went away')),
      fetchAnnotations: () => Promise.reject(new Error('unused')),
    };
    const first = syncKindle({ source: broken, sink, clock, delay: fakeKindleDelay() });
    const joined = syncKindle({ source: broken, sink, clock, delay: fakeKindleDelay() });
    await expect(first).rejects.toThrow('the host went away');
    await expect(joined).rejects.toThrow('the host went away');
    const later = await syncKindle({
      source: fakeKindleNotebook({ library: libraryOf() }),
      sink,
      clock,
      delay: fakeKindleDelay(),
    });
    expect(later.kind).toBe('synced');
  });
});

/*
 * Second verification of PR #511 (after the fix round at b4e81c01): a book Amazon answers "too
 * many requests" for, a run of server errors, and the fetch gap when the clock jumps forward.
 */
describe('syncKindle when Amazon says it is asked too often', () => {
  const asins = ['B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3', 'B0EXAMPLE4', 'B0EXAMPLE5'];
  const answered = (status: number) => ({ status, html: '<p>Go away</p>', redirectedTo: null });

  it('stops asking for books after a 429, rather than asking for every other one', async () => {
    const tooMany = { status: 429, html: '<p>Too many requests</p>', redirectedTo: null };
    const source = fakeKindleNotebook({
      library: libraryOf(...asins),
      books: Object.fromEntries(asins.map((asin) => [asin, [tooMany]])),
    });
    await syncKindle({ source, sink: fakeKindleSink(), clock, delay: fakeKindleDelay() });
    const asked = source.calls.filter((call) => call.call === 'annotations').length;
    expect(asked).toBe(1);
  });

  it('stops as rate limited on a 403 or a 429, for the library or a book, keeping what it added', async () => {
    for (const status of [403, 429]) {
      const onLibrary = fakeKindleNotebook({ library: answered(status) });
      expect(await syncKindle({ source: onLibrary, sink: fakeKindleSink(), clock, delay })).toEqual(
        { kind: 'rate_limited', status, books: [], added: 0 },
      );
      const onSecond = fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3'),
        books: {
          B0EXAMPLE1: [bookPage('B0EXAMPLE1', highlightRow('IDRATE00001', 'Call me Ishmael.'))],
          B0EXAMPLE2: [answered(status)],
        },
      });
      const report = await syncKindle({ source: onSecond, sink: fakeKindleSink(), clock, delay });
      expect(report).toMatchObject({ kind: 'rate_limited', status, added: 1 });
      expect(onSecond.calls.filter((call) => call.call === 'annotations')).toHaveLength(2);
    }
  });

  it('stops as unavailable after three books in a row answer a server error, keeping them', async () => {
    const source = fakeKindleNotebook({
      library: libraryOf(...asins),
      books: {
        B0EXAMPLE1: [bookPage('B0EXAMPLE1', highlightRow('IDSERVER0001', 'Call me Ishmael.'))],
        ...Object.fromEntries(asins.slice(1).map((asin) => [asin, [answered(503)]])),
      },
    });
    const report = await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    expect(source.calls.filter((call) => call.call === 'annotations')).toHaveLength(4);
    expect(report).toMatchObject({ kind: 'unavailable', message: 'Amazon answered 503', added: 1 });
    expect('books' in report ? report.books.map((book) => book.kind) : []).toEqual([
      'added',
      'unavailable',
      'unavailable',
      'unavailable',
    ]);
  });

  it.each([
    ['500, 502, good, 503, 404', [500, 502, 0, 503, 404]],
    ['500, 404, 502, 503', [500, 404, 502, 503]],
  ])('goes on past server errors that are not three in a row (%s)', async (_label, answers) => {
    const books = Object.fromEntries(
      answers.map((status, index) => {
        const asin = `B0EXAMPLE${index + 1}`;
        return [
          asin,
          status === 0
            ? [bookPage(asin, highlightRow('IDSERVER0003', 'Reader.'))]
            : [answered(status)],
        ];
      }),
    );
    const source = fakeKindleNotebook({
      library: libraryOf(...answers.map((_, index) => `B0EXAMPLE${index + 1}`)),
      books,
    });
    const report = await syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    expect(report).toMatchObject({ kind: 'synced' });
    expect(source.calls.filter((call) => call.call === 'annotations')).toHaveLength(answers.length);
  });
});

describe('syncKindle pacing when the clock jumps forward', () => {
  it('still waits the fetch gap between two fetches when the clock is set forward mid-sync', async () => {
    // Readings: the slot's start, then the library fetch ending; after that the Mac's clock is
    // corrected forward an hour, though no time has passed between the two fetches.
    let readings = 0;
    const steppedForward = { now: () => (readings++ < 2 ? NOW : NOW + HOUR) };
    const pacing = fakeKindleDelay();
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: {
        B0EXAMPLE1: [
          bookPage('B0EXAMPLE1', highlightRow('IDCLOCKFWD01', 'Reader, I married him.')),
        ],
      },
    });
    await syncKindle({ source, sink: fakeKindleSink(), clock: steppedForward, delay: pacing });
    expect(pacing.waits).toEqual([KINDLE_MIN_FETCH_GAP_MS]);
  });
});

describe('syncKindle says what the sink wrote, not what it was handed (PR #514)', () => {
  const twoHighlights = bookPage(
    'B0EXAMPLE1',
    highlightRow('IDWRITTEN001', 'Call me Ishmael.') +
      highlightRow('IDWRITTEN002', 'Reader, I married him.'),
  );
  const source = () =>
    fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: { B0EXAMPLE1: [twoHighlights] },
    });

  it('counts the entries the note took, when it held one of the two already', async () => {
    const sink = fakeKindleSink({ answers: { B0EXAMPLE1: { written: 1, unplaced: [] } } });
    const report = await syncKindle({ source: source(), sink, clock, delay });
    expect(report).toMatchObject({ kind: 'synced', added: 1 });
    expect(describeKindleSync(report).message).toBe('Added 1 highlight from 1 book.');
  });

  it('names a highlight the note could not place, and still counts the rest', async () => {
    const sink = fakeKindleSink({
      answers: { B0EXAMPLE1: { written: 1, unplaced: ['page xiv'] } },
    });
    const report = await syncKindle({ source: source(), sink, clock, delay });
    expect(report).toMatchObject({
      books: [{ kind: 'added', added: 1, unplaced: ['page xiv'] }],
    });
    expect(describeKindleSync(report).message).toBe(
      "Added 1 highlight from 1 book. 1 highlight couldn't be placed (page xiv).",
    );
  });

  it('tells the sink a sync begins, once, before any note is read', async () => {
    const sink = fakeKindleSink();
    await syncKindle({ source: source(), sink, clock, delay });
    expect(sink.began.count).toBe(1);
  });
});
