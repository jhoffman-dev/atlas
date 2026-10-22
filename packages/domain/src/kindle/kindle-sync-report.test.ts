import { describe, expect, it } from 'vitest';
import {
  describeKindleSync,
  KINDLE_SIGN_IN_MESSAGE,
  KINDLE_UNRECOGNISED_MESSAGE,
} from './kindle-sync-report.ts';
import type { KindleBookOutcome } from './kindle-sync-report.ts';

const added = (count: number, asin = 'B0EXAMPLE1'): KindleBookOutcome => ({
  kind: 'added',
  asin,
  title: 'Persuasion',
  added: count,
});

describe('describeKindleSync', () => {
  it('asks the person to sign in again, plainly', () => {
    expect(describeKindleSync({ kind: 'sign_in_required' })).toEqual({
      message: KINDLE_SIGN_IN_MESSAGE,
      ok: false,
    });
    expect(KINDLE_SIGN_IN_MESSAGE).toBe('Kindle sync needs you to sign in again.');
  });

  it('says it could not read Amazon’s page when the page changed', () => {
    expect(describeKindleSync({ kind: 'unrecognised', reason: 'the page has no library' })).toEqual(
      { message: KINDLE_UNRECOGNISED_MESSAGE, ok: false },
    );
    expect(KINDLE_UNRECOGNISED_MESSAGE).toMatch(/^Couldn't read Amazon's page/);
  });

  it('says Amazon could not be reached, and why, and that it will try again', () => {
    expect(describeKindleSync({ kind: 'unavailable', message: 'timed out' })).toEqual({
      message:
        "Couldn't reach Amazon's Kindle notebook (timed out). Kindle sync will try again later.",
      ok: false,
    });
  });

  it('counts the new highlights and the books they came from', () => {
    expect(
      describeKindleSync({
        kind: 'synced',
        books: [added(2), added(1, 'B0EXAMPLE2'), added(0)],
        added: 3,
      }),
    ).toEqual({ message: 'Added 3 highlights from 2 books.', ok: true });
    expect(describeKindleSync({ kind: 'synced', books: [added(1)], added: 1 })).toEqual({
      message: 'Added 1 highlight from 1 book.',
      ok: true,
    });
  });

  it('says when there is nothing new, an empty library included', () => {
    expect(describeKindleSync({ kind: 'synced', books: [added(0)], added: 0 })).toEqual({
      message: 'Nothing new from Kindle.',
      ok: true,
    });
    expect(describeKindleSync({ kind: 'synced', books: [], added: 0 }).message).toBe(
      'Nothing new from Kindle.',
    );
  });

  it('says how many books it could not sync, and is not ok when any', () => {
    const books: KindleBookOutcome[] = [
      added(2),
      { kind: 'unrecognised', asin: 'B0EXAMPLE2', title: 'Emma', reason: 'x' },
      { kind: 'not_written', asin: 'B0EXAMPLE3', title: 'Sanditon', message: 'disk full' },
    ];
    expect(describeKindleSync({ kind: 'synced', books, added: 2 })).toEqual({
      message: "Added 2 highlights from 1 book. Couldn't sync 2 books.",
      ok: false,
    });
    expect(
      describeKindleSync({
        kind: 'synced',
        books: [{ kind: 'unavailable', asin: 'B0EXAMPLE2', title: 'Emma', message: 'timed out' }],
        added: 0,
      }).message,
    ).toBe("Nothing new from Kindle. Couldn't sync 1 book.");
  });
});
