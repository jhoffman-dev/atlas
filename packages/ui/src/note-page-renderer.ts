import { generateHTML } from '@tiptap/core';
import type { EditorDocument } from '@atlas/domain';
import { createReadingExtensions } from './editor/extensions.ts';

/**
 * Draws a note's body as HTML for a picture of its page — through the same
 * schema the app reads notes with, so it looks as the note does, and every
 * piece of text in it is escaped by the editor's serializer: a block of raw
 * HTML comes out as its source in a `<pre>`, as the editor shows it.
 */
export interface NotePageRendering {
  bodyHtml(doc: EditorDocument): string;
  readonly styles: string;
}

// Images arrive already written into the document as `data:` URLs; nothing
// is loaded while serialising, which only reads each node's schema.
const extensions = createReadingExtensions({ loadImage: () => Promise.resolve(null) });

/**
 * The renderer, with the app's page look in the light theme. `fontUrl` is
 * Manrope as a `data:` URL, so the page fetches nothing; without it the
 * system's own sans-serif stands in.
 */
export function createNotePageRenderer({ fontUrl }: { fontUrl: string | null }): NotePageRendering {
  return {
    bodyHtml: (doc) => generateHTML(doc as Parameters<typeof generateHTML>[0], extensions),
    styles: notePageStyles(fontUrl),
  };
}

/**
 * The page's look: the app's light palette and reading type, set large — the
 * page is pictured at half size and shown smaller still, on a card.
 */
export function notePageStyles(fontUrl: string | null): string {
  const face =
    fontUrl === null
      ? ''
      : `@font-face{font-family:'Manrope Variable';font-style:normal;font-weight:200 800;src:url(${JSON.stringify(fontUrl)}) format('woff2');}`;
  return `${face}${PAGE_STYLES}`;
}

const PAGE_STYLES = `
*{box-sizing:border-box}
html,body{margin:0;background:#ffffff;color:#151d3b}
body{font-family:'Manrope Variable','Manrope',-apple-system,system-ui,sans-serif;font-size:30px;line-height:1.5;-webkit-font-smoothing:antialiased}
.page{max-width:1120px;margin:0 auto;padding:64px 80px}
.page__title{font-size:68px;line-height:1.15;letter-spacing:-0.025em;font-weight:750;margin:0 0 28px}
.page__body h1{font-size:50px;letter-spacing:-0.02em;margin:1.2em 0 .4em}
.page__body h2{font-size:42px;margin:1.2em 0 .4em}
.page__body h3{font-size:36px;margin:1.1em 0 .3em}
.page__body p{margin:0 0 .75em}
.page__body a{color:#2468d8;text-decoration:none}
.page__body img{display:block;max-width:100%;height:auto;border-radius:12px;margin:.75em 0}
.page__body ul,.page__body ol{padding-left:1.4em;margin:0 0 .75em}
.page__body ul[data-type=taskList]{list-style:none;padding-left:.2em}
.page__body ul[data-type=taskList] li{display:flex;gap:.5em}
.page__body blockquote{margin:0 0 .75em;padding-left:1em;border-left:3px solid #d5dbe8;color:#4e577a}
.page__body pre{font-family:ui-monospace,SFMono-Regular,monospace;font-size:24px;background:#f2f4f9;border-radius:10px;padding:14px 16px;white-space:pre-wrap;overflow:hidden}
.page__body code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.88em;background:#eef1f7;border-radius:5px;padding:.1em .3em}
.page__body pre code{background:none;padding:0}
.page__body table{border-collapse:collapse;margin:0 0 .75em}
.page__body td,.page__body th{border:1px solid #d5dbe8;padding:6px 10px}
.page__body hr{border:0;border-top:1px solid #d5dbe8;margin:1.5em 0}
.page__body [data-wikilink]{color:#2468d8}
.page__body .callout{background:#f2f4f9;border-radius:12px;padding:14px 18px;margin:0 0 .75em}
`;
