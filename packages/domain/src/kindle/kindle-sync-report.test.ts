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

describe('describeKindleSync of a sync that was stopped', () => {
  it('keeps what was added before a sign-in stopped it, and says so', () => {
    expect(
      describeKindleSync({
        kind: 'sign_in_required',
        books: [added(2), added(1, 'B0EXAMPLE2')],
        added: 3,
      }),
    ).toEqual({
      message: `${KINDLE_SIGN_IN_MESSAGE} Before it stopped, 3 highlights were added from 2 books.`,
      ok: false,
    });
  });

  it('says a robot check is its own thing, and that Kindle sync will not run by itself for a day', () => {
    const described = describeKindleSync({ kind: 'robot_check', books: [], added: 0 });
    expect(described.ok).toBe(false);
    expect(described.message).toMatch(/robot/i);
    expect(described.message).toMatch(/24 hours/);
    expect(described.message).not.toMatch(/sign in again/i);
  });

  it('says Kindle is not connected, without saying it will try again', () => {
    const described = describeKindleSync({ kind: 'not_connected', books: [], added: 0 });
    expect(described).toEqual({
      message: "Kindle isn't connected on this Mac. Connect it in Settings to sync.",
      ok: false,
    });
  });

  it('says what the Mac cannot do, in the host’s words', () => {
    expect(
      describeKindleSync({
        kind: 'unsupported',
        message: 'Kindle sync needs macOS 14 or later',
        books: [],
        added: 0,
      }),
    ).toEqual({
      message: "Kindle sync can't run on this Mac: Kindle sync needs macOS 14 or later.",
      ok: false,
    });
  });

  it('names the store Amazon sent the notebook to, rather than say the page changed', () => {
    const described = describeKindleSync({
      kind: 'unsupported_store',
      store: 'read.amazon.co.uk',
      books: [],
      added: 0,
    });
    expect(described.message).toContain('read.amazon.co.uk');
    expect(described.message).toContain('read.amazon.com');
    expect(described.message).not.toMatch(/Couldn't read Amazon's page/);
    expect(described.ok).toBe(false);
  });
});

describe('describeKindleSync', () => {
  it('asks the person to sign in again, plainly', () => {
    expect(describeKindleSync({ kind: 'sign_in_required', books: [], added: 0 })).toEqual({
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
    expect(
      describeKindleSync({ kind: 'unavailable', message: 'timed out', books: [], added: 0 }),
    ).toEqual({
      message:
        "Couldn't reach Amazon's Kindle notebook (timed out). Kindle sync will try again later.",
      ok: false,
    });
  });

  it('says what a sync had added before Amazon stopped answering it', () => {
    const described = describeKindleSync({
      kind: 'unavailable',
      message: 'timed out',
      books: [{ kind: 'added', asin: 'B0EXAMPLE1', title: 'Emma', added: 2 }],
      added: 2,
    });
    expect(described).toEqual({
      message:
        "Couldn't reach Amazon's Kindle notebook (timed out). Kindle sync will try again later. Before it stopped, 2 highlights were added from 1 book.",
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
