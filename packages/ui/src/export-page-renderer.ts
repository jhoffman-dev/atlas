import { generateHTML } from '@tiptap/core';
import type { EditorDocument } from '@atlas/domain';
import { createReadingExtensions } from './editor/extensions.ts';
import type { NotePageRendering } from './note-page-renderer.ts';

// Pictures arrive already written into the document as `data:` URLs; nothing
// is loaded while serialising, which only reads each node's schema.
const extensions = createReadingExtensions({ loadImage: () => Promise.resolve(null) });

/**
 * A note drawn for a PDF or a Google Doc (#501): the body through the
 * schema the reading view uses, so it reads as the note does, every piece
 * of text escaped; the look is the app's light theme at print size — points
 * on a letter page, not pixels on a card.
 */
export function createExportPageRenderer(): NotePageRendering {
  return {
    bodyHtml: (doc: EditorDocument) =>
      generateHTML(doc as Parameters<typeof generateHTML>[0], extensions),
    styles: EXPORT_STYLES,
  };
}

/*
 * The body's side margins are the page's own; its top and bottom are set by
 * the paging script, sheet by sheet. Rows, lines and pictures do not break
 * across a printed page either, for a Doc printed from Google.
 */
const EXPORT_STYLES = `
*{box-sizing:border-box}
html,body{margin:0;background:#ffffff;color:#151d3b}
body{font-family:-apple-system,'Helvetica Neue',system-ui,sans-serif;font-size:11px;line-height:1.5;-webkit-font-smoothing:antialiased}
.export{padding:0 54px}
.export__title{font-size:24px;line-height:1.2;letter-spacing:-0.02em;font-weight:700;margin:0 0 10px}
.export__properties{border-collapse:collapse;margin:0 0 16px;font-size:10px;color:#4e577a}
.export__properties th{text-align:left;font-weight:600;padding:2px 14px 2px 0;vertical-align:top;white-space:nowrap}
.export__properties td{padding:2px 0}
.export__body h1{font-size:19px;margin:1.1em 0 .4em}
.export__body h2{font-size:16px;margin:1.1em 0 .4em}
.export__body h3{font-size:13px;margin:1em 0 .3em}
.export__body p{margin:0 0 .7em}
.export__body p>strong:first-child{color:#151d3b}
.export__body a{color:#2468d8;text-decoration:none}
.export__body img{display:block;max-width:100%;max-height:640px;height:auto;margin:.6em 0}
.export__body ul,.export__body ol{padding-left:1.4em;margin:0 0 .7em}
.export__body ul[data-type=taskList]{list-style:none;padding-left:.2em}
.export__body ul[data-type=taskList] li{display:flex;gap:.5em}
.export__body blockquote{margin:0 0 .7em;padding-left:1em;border-left:2px solid #d5dbe8;color:#4e577a}
.export__body pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;background:#f2f4f9;border-radius:4px;padding:8px 10px;white-space:pre-wrap}
.export__body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;background:#eef1f7;border-radius:3px;padding:.05em .25em}
.export__body pre code{background:none;padding:0}
.export__body table{border-collapse:collapse;margin:0 0 .7em;width:100%}
.export__body td,.export__body th{border:1px solid #d5dbe8;padding:4px 6px;vertical-align:top;text-align:left}
.export__body th{background:#f5f6fa}
.export__body hr{border:0;border-top:1px solid #d5dbe8;margin:1.2em 0}
.export__body [data-wikilink]{color:#2468d8}
.export__body .callout{background:#f2f4f9;border-radius:6px;padding:8px 12px;margin:0 0 .7em}
tr,img,pre,blockquote,li{break-inside:avoid}
h1,h2,h3,h4{break-after:avoid}
`;
