import { describe, expect, it } from 'vitest';
import { describeKindleSync } from '@dfai/domain';
import { fakeKindleNotebook, fakeKindleSink, kindlePage } from '../testing/fake-kindle.ts';
import { KindleFetchError } from './ports.ts';
import { syncKindle } from './sync-kindle.ts';

/*
 * Attack on PR #511: the sync under orders and answers it was not written
 * for. The books are invented; the quotes are public domain.
 */

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

const bookPage = (asin: string, rows: string) =>
  kindlePage(
    `<input id="kp-notebook-annotations-asin" value="${asin}"><div id="kp-notebook-annotations">${rows}</div>`,
  );

const highlightRow = (id: string, quote: string, note?: string) =>
  `<div id="${id}" class="a-row a-spacing-base"><span id="highlight">${quote}</span>${
    note === undefined ? '' : `<span id="note">${note}</span>`
  }</div>`;

describe('syncKindle under orders it was not written for (attack on #511)', () => {
  it('adds each highlight once when two syncs run at the same time', async () => {
    const page = bookPage('B0EXAMPLE1', highlightRow('IDCONCURRENT1', 'Call me Ishmael.'));
    const source = () =>
      fakeKindleNotebook({ library: libraryOf('B0EXAMPLE1'), books: { B0EXAMPLE1: [page] } });
    const sink = fakeKindleSink();
    // The sync on launch and the one from ⌘K, say: both read the note before either writes.
    await Promise.all([
      syncKindle({ source: source(), sink, clock }),
      syncKindle({ source: source(), sink, clock }),
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
    });
    const notes = sink.writes.flatMap((write) => write.highlights.map((h) => h.note));
    // Observed: [null] -- the key ignores the note, so the note never arrives.
    expect(notes).toContain('The famous last chapter.');
  });

  it('does not tell a Mac that was never connected that it will try again later', async () => {
    const source = fakeKindleNotebook({
      library: new KindleFetchError('not_connected', 'Kindle is not connected on this Mac'),
    });
    const report = await syncKindle({ source, sink: fakeKindleSink(), clock });
    // Observed: "Couldn't reach Amazon's Kindle notebook (...). Kindle sync will try again later."
    expect(describeKindleSync(report).message).not.toMatch(/try again later/);
  });

  it('stops at the first book when the session is gone mid-sync, rather than asking for every other book', async () => {
    const asins = ['B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3', 'B0EXAMPLE4'];
    const gone = new KindleFetchError('not_connected', 'Kindle is not connected on this Mac');
    const source = fakeKindleNotebook({
      library: libraryOf(...asins),
      books: Object.fromEntries(asins.map((asin) => [asin, [gone]])),
    });
    await syncKindle({ source, sink: fakeKindleSink(), clock });
    const asked = source.calls.filter((call) => call.call === 'annotations').length;
    expect(asked).toBe(1);
  });
});
