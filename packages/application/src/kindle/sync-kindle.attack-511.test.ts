import { describe, expect, it } from 'vitest';
import {
  fakeKindleDelay,
  fakeKindleNotebook,
  fakeKindleSink,
  kindlePage,
} from '../testing/fake-kindle.ts';
import { KindleFetchError } from './ports.ts';
import { KINDLE_MIN_FETCH_GAP_MS, syncKindle } from './sync-kindle.ts';

/*
 * Verification of PR #511 after its fix round: the sync against clocks, networks and notes the
 * fixes were not tested with. The books are invented; the quotes are public domain.
 */

const NOW = Date.UTC(2026, 9, 21, 9, 0);
const HOUR = 60 * 60 * 1000;
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

const noteRow = (id: string, note: string) =>
  `<div id="${id}" class="a-row a-spacing-base"><span id="note">${note}</span></div>`;

const highlightRow = (id: string, quote: string) =>
  `<div id="${id}" class="a-row a-spacing-base"><span id="highlight">${quote}</span></div>`;

describe('syncKindle, verified after the fix round', () => {
  it('never waits longer than the fetch gap when the clock is set back mid-sync', async () => {
    // The Mac's clock is corrected back an hour after the library is read.
    let readings = 0;
    const steppedBack = { now: () => (readings++ === 0 ? NOW : NOW - HOUR) };
    const delay = fakeKindleDelay();
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: {
        B0EXAMPLE1: [bookPage('B0EXAMPLE1', highlightRow('IDCLOCKBACK1', 'Call me Ishmael.'))],
      },
    });
    await syncKindle({ source, sink: fakeKindleSink(), clock: steppedBack, delay });
    expect(Math.max(0, ...delay.waits)).toBeLessThanOrEqual(KINDLE_MIN_FETCH_GAP_MS);
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
