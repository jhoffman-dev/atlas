import { describe, expect, it } from 'vitest';
import { bookCss } from './chapter-styles.ts';

/*
 * Regressions from the attack on and verification of PR #536 (#505, ADR-0045 §5): the reader's cleaning of a book's CSS
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

  it('keeps no other site named in a -webkit-image-set(), by an @import in capitals, or one with a comment for its space', async () => {
    const css = [
      `p { background-image: -webkit-image-set('https://${BEACON}/webkit.png' 1x); }`,
      `@IMPORT "https://${BEACON}/capitals.css";`,
      `@import/**/"https://${BEACON}/comment.css";`,
      `@import url(https://${BEACON}/bare.css) screen;`,
      `h1 { background: image-set(u\\rl("https://${BEACON}/nested.png") 1x); }`,
    ].join('\n');
    expect(await made(css)).not.toContain(BEACON);
  });

  it("keeps a book's own picture in an image-set(), at its address, and a type() as it is", async () => {
    const css = `p { background-image: image-set("pics/hare.png" 1x type("image/png"), "data:image/png;base64,AA==" 2x); }`;
    const kept = await bookCss({
      css,
      from: 'OEBPS/chapter.xhtml',
      address: async (path) =>
        path === 'OEBPS/pics/hare.png' ? 'data:image/png;base64,HARE' : null,
      stylesheet: async () => null,
    });
    expect(kept).toBe(
      `p { background-image: image-set("data:image/png;base64,HARE" 1x type("image/png"), "data:image/png;base64,AA==" 2x); }`,
    );
  });

  it('reads an escape of a letter, and leaves every other escape meaning what it meant', async () => {
    // The space after `\41` ends the escape, so the selector is `.10A` and the brace follows it.
    const css = `.\\31 0\\41 { content: "\\"\\2f\\2a"; } \\41 b { color: r\\65 d; }`;
    expect(await made(css)).toBe(`.\\31 0A{ content: "\\"\\2f \\2a "; } Ab { color: red; }`);
  });
});

/** The CSS as a browser reads its strings: a backslash before a line break joins the lines. */
const asRead = (css: string) => css.replace(/\\\r?\n/g, '');

// From the verification of PR #536: spellings WebKit loads (seen asking a fake
// server for each, with the frame's policy taken away) that the cleaning kept.
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
