import { describe, expect, it } from 'vitest';
import { bookCss } from './chapter-styles.ts';

/*
 * Attack on PR #536 (#505, ADR-0045 §5): the reader's cleaning of a book's CSS
 * is meant to stand alone — "each layer assumes the others failed" — so no
 * reference to another site may survive it, whatever spelling CSS allows. The
 * frame's policy still refuses these loads in WebKit; these are gaps in the
 * cleaning layer only.
 */

const BEACON = 'beacon.example.com';

const made = (css: string) =>
  bookCss({
    css,
    from: 'OEBPS/chapter.xhtml',
    address: async () => null,
    stylesheet: async () => null,
  });

describe("a book's CSS made the book's own", () => {
  it('keeps no other site named in a url() whose name is written with a CSS escape', async () => {
    // `u\72l(` is the url token to a CSS parser: `\72` is "r".
    const css = `p { background: u\\72l(https://${BEACON}/escaped.png); }`;
    expect(await made(css)).not.toContain(BEACON);
  });

  it('keeps no other site named as a plain string in image-set()', async () => {
    // image-set() takes a string as a URL, with no url() around it.
    const css = `p { background-image: image-set("https://${BEACON}/set.png" 1x); }`;
    expect(await made(css)).not.toContain(BEACON);
  });

  it('keeps no other site named by an @import whose name is written with a CSS escape', async () => {
    const css = `@\\69mport "https://${BEACON}/escaped.css";\np { color: red; }`;
    expect(await made(css)).not.toContain(BEACON);
  });
});
