import { splitWikiLinks, wikiLinkLabel } from '../markdown/wikilink.ts';
import { escapeHtml } from '../thumbnails/note-page.ts';

/*
 * A note as one page to print or to hand to Google Docs (#501): its title,
 * a summary of its properties, and its body as the app's reading view draws
 * it, in the light theme. Every piece of text is escaped — the body by the
 * editor's own serializer, the rest here — so nothing in a note can run.
 */

/** A page's size and margin, in points: US Letter, three-quarter-inch margins. */
export interface ExportPageSize {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
}

export const EXPORT_PAGE: ExportPageSize = { width: 612, height: 792, margin: 54 };

/** One line of the properties summary: the key as written, and its value as words. */
export interface PropertyLine {
  readonly label: string;
  readonly value: string;
}

/** Keys the page already shows another way: the title is the page's heading. */
const SHOWN_ELSEWHERE: ReadonlySet<string> = new Set(['title']);

/**
 * A note's properties as words, in the order they are written: a link as
 * the words it shows, a list as its items, a yes-or-no as Yes or No. A
 * property with no value is left out, as the reading view leaves it out.
 */
export function propertySummary(properties: Readonly<Record<string, unknown>>): PropertyLine[] {
  return Object.entries(properties).flatMap(([label, value]) => {
    if (SHOWN_ELSEWHERE.has(label.toLowerCase())) return [];
    const words = valueWords(value);
    return words === '' ? [] : [{ label, value: words }];
  });
}

function valueWords(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return linksAsWords(value).trim();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    return value
      .map(valueWords)
      .filter((words) => words !== '')
      .join(', ');
  }
  return JSON.stringify(value) ?? '';
}

/** Text with each `[[link]]` in it as the words it shows. */
function linksAsWords(text: string): string {
  return splitWikiLinks(text)
    .map((piece) => (piece.kind === 'text' ? piece.value : wikiLinkLabel(piece)))
    .join('');
}

/**
 * The policy the page is made under: nothing fetched but pictures, nothing
 * run but the page's own script — the one the PDF's pages are laid out
 * with, when it is given one.
 */
export function exportPagePolicy({ script }: { script: boolean }): string {
  return [
    "default-src 'none'",
    script ? "script-src 'unsafe-inline'" : "script-src 'none'",
    "style-src 'unsafe-inline'",
    'font-src data:',
    'img-src data: https:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** `</` ended early, as an HTML parser reads a style or a script: `</style` in its words cannot close it. */
const sealed = (text: string, tag: string): string =>
  text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

/**
 * The whole page. `bodyHtml` is the editor's serialisation of the note,
 * which escapes every piece of text it holds; `styles` are the app's own;
 * `script`, given only for a PDF, lays the page out on sheets.
 */
export function exportPageDocument({
  title,
  properties,
  bodyHtml,
  styles,
  script = null,
}: {
  title: string;
  properties: readonly PropertyLine[];
  bodyHtml: string;
  styles: string;
  script?: string | null;
}): string {
  const heading = escapeHtml(title);
  const summary =
    properties.length === 0
      ? ''
      : `<table class="export__properties"><tbody>${properties
          .map(
            (line) =>
              `<tr><th scope="row">${escapeHtml(line.label)}</th><td>${escapeHtml(line.value)}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  return [
    '<!doctype html>',
    `<html lang="en"><head>`,
    `<meta http-equiv="Content-Security-Policy" content="${exportPagePolicy({ script: script !== null })}">`,
    '<meta charset="utf-8">',
    `<title>${heading}</title>`,
    `<style>${sealed(styles, 'style')}</style>`,
    '</head>',
    `<body><article class="export"><h1 class="export__title">${heading}</h1>`,
    summary,
    `<div class="export__body">${bodyHtml}</div></article>`,
    script === null ? '' : `<script>${sealed(script, 'script')}</script>`,
    '</body></html>',
  ].join('');
}
