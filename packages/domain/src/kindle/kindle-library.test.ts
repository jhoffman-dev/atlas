import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readKindleLibrary } from './kindle-library.ts';
import type { KindleRawPage } from './kindle-types.ts';

/*
 * The library page, from hand-made fixtures in the shape of Amazon's (see
 * fixtures/README.md — they still need checking against a real page).
 * The books are public domain; nothing here came from a real account.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const ok = (html: string): KindleRawPage => ({ status: 200, html, redirectedTo: null });

const library = (books: string) => ok(`<div id="kp-notebook-library">${books}</div>`);

const book = (attributes: string, inner: string) =>
  `<div ${attributes} class="a-row kp-notebook-library-each-book">${inner}</div>`;

const TITLE = '<h2 class="kp-notebook-searchable">Persuasion</h2>';

describe('readKindleLibrary', () => {
  it('reads every book in the library: ASIN, title, author without its "By:", and cover', () => {
    expect(readKindleLibrary(ok(fixture('library.html')))).toEqual({
      kind: 'library',
      books: [
        {
          asin: 'B0EXAMPLE1',
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          coverUrl: 'https://m.media-amazon.com/images/I/example-pride._SY160.jpg',
        },
        {
          asin: 'B0EXAMPLE2',
          title: 'Moby-Dick; or, The Whale',
          author: 'Herman Melville',
          coverUrl: 'https://m.media-amazon.com/images/I/example-moby._SY160.jpg',
        },
        {
          asin: 'B0EXAMPLE3',
          title: 'Frankenstein; or, The Modern Prometheus',
          author: null,
          coverUrl: 'https://m.media-amazon.com/images/I/example-frankenstein._SY160.jpg',
        },
      ],
    });
  });

  it('reads a library with no books as an empty library, not as a page it does not know', () => {
    expect(readKindleLibrary(ok(fixture('library-empty.html')))).toEqual({
      kind: 'library',
      books: [],
    });
  });

  it('says a sign-in is needed when Amazon answers with its sign-in page', () => {
    expect(readKindleLibrary(ok(fixture('sign-in.html')))).toEqual({ kind: 'sign_in_required' });
  });

  it('says it does not know a page with no library, apart from one asking to sign in', () => {
    expect(readKindleLibrary(ok(fixture('unrecognised.html')))).toEqual({
      kind: 'unrecognised',
      reason: 'the page has no library',
    });
    expect(readKindleLibrary(ok(''))).toMatchObject({ kind: 'unrecognised' });
  });

  it('refuses the whole page when a book has no ASIN, rather than reading the rest', () => {
    const page = library(book('id="B0EXAMPLE1"', TITLE) + book('', TITLE));
    expect(readKindleLibrary(page)).toEqual({
      kind: 'unrecognised',
      reason: 'a book in the library has no ASIN',
    });
  });

  it('refuses an ASIN that could carry anything but letters, digits, - and _', () => {
    for (const id of ['B0 EXAMPLE', 'B0&x=1', 'x'.repeat(65)]) {
      expect(readKindleLibrary(library(book(`id="${id}"`, TITLE)))).toMatchObject({
        kind: 'unrecognised',
      });
    }
  });

  it('refuses the whole page when a book has no title', () => {
    expect(readKindleLibrary(library(book('id="B0EXAMPLE1"', '<h2 class="other">x</h2>')))).toEqual(
      { kind: 'unrecognised', reason: 'the book B0EXAMPLE1 has no title' },
    );
    expect(
      readKindleLibrary(
        library(book('id="B0EXAMPLE1"', '<h2 class="kp-notebook-searchable"> </h2>')),
      ),
    ).toMatchObject({ kind: 'unrecognised' });
  });

  it('keeps a book the page lists twice once', () => {
    const page = library(book('id="B0EXAMPLE1"', TITLE) + book('id="B0EXAMPLE1"', TITLE));
    expect(readKindleLibrary(page)).toMatchObject({
      kind: 'library',
      books: [{ asin: 'B0EXAMPLE1' }],
    });
  });

  it('reads a cover that is not https, or not an address at all, as no cover', () => {
    for (const src of ['http://example.com/c.jpg', 'not a url', 'javascript:alert(1)']) {
      const page = library(
        book('id="B0EXAMPLE1"', `${TITLE}<img class="kp-notebook-cover-image" src="${src}">`),
      );
      expect(readKindleLibrary(page)).toMatchObject({ books: [{ coverUrl: null }] });
    }
  });

  it('reads an author shown without "By:" as it is, and an empty one as none', () => {
    const named = library(
      book('id="B0EXAMPLE1"', `${TITLE}<p class="kp-notebook-searchable">Jane Austen</p>`),
    );
    expect(readKindleLibrary(named)).toMatchObject({ books: [{ author: 'Jane Austen' }] });
    const empty = library(
      book('id="B0EXAMPLE1"', `${TITLE}<p class="kp-notebook-searchable">By: </p>`),
    );
    expect(readKindleLibrary(empty)).toMatchObject({ books: [{ author: null }] });
  });

  it('passes on what the page check found: a redirect to sign in, an error status', () => {
    expect(
      readKindleLibrary({
        status: 302,
        html: '',
        redirectedTo: 'https://www.amazon.com/ap/signin',
      }),
    ).toEqual({ kind: 'sign_in_required' });
    expect(readKindleLibrary({ status: 503, html: '', redirectedTo: null })).toEqual({
      kind: 'unavailable',
      status: 503,
    });
  });
});
