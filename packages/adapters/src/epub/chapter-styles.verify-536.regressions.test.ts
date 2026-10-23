import { describe, expect, it } from 'vitest';
import { bookCss } from './chapter-styles.ts';

/*
 * Regressions from the verification of PR #536 (#505, ADR-0045 §5): spellings
 * of another site's address that WebKit loads (seen asking a fake server for
 * each, with the frame's policy taken away) and the cleaning still keeps. The
 * frame's policy (`img-src data:`) refuses each load in WebKit; these are
 * gaps in the cleaning layer, which is meant to stand alone.
 */

const BEACON = 'beacon.example.com';

const made = (css: string) =>
  bookCss({
    css,
    from: 'OEBPS/chapter.xhtml',
    address: async () => null,
    stylesheet: async () => null,
  });

/** The CSS as a browser reads its strings: a backslash before a line break joins the lines. */
const asRead = (css: string) => css.replace(/\\\r?\n/g, '');

describe("a book's CSS made the book's own, in the spellings WebKit still loads", () => {
  it('keeps no other site named in a url() string broken across two lines with a backslash', async () => {
    // In a CSS string, a backslash before a line break is no character: the address is one line.
    const css = `p { background: url("https://bea\\\ncon.example.com/joined.png"); }`;
    expect(asRead(await made(css))).not.toContain(BEACON);
  });

  it('keeps no other site named in an image-set() after a comment holding a closing parenthesis', async () => {
    const css = `p { background-image: image-set(/* ) */ "https://${BEACON}/paren.png" 1x); }`;
    expect(await made(css)).not.toContain(BEACON);
  });

  it('keeps no other site named in an image-set() between comments holding quotes', async () => {
    // Read as one string, `'#*/"https://…" 1x/*'` begins with `#` and is kept as a place in the chapter.
    const css = `p { background-image: image-set(/*'#*/"https://${BEACON}/quote.png" 1x/*'*/); }`;
    expect(await made(css)).not.toContain(BEACON);
  });
});
