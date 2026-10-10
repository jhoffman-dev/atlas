import { calloutLabel, parseCalloutMarker, type CalloutMarker } from '../markdown/callout.ts';
import { formatWikiLink, type WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import type { DroppedContent } from './export-drops.ts';
import type { MarkdownSpan, RawPart } from './raw-parts.ts';

/*
 * Markdown the editor does not model — a block with a footnote, inline HTML or
 * a comment in it — is exported as its own text (P32-07), rewritten in place
 * by the same rules as every other block, at the parts the markdown reader
 * found in it: each wiki link as its words; an image or a link the page cannot
 * reach as its words, and a reference as the link it stands for; each
 * comment, closed or not, gone; each id gone; and each callout's marker as
 * its name in bold. Code, and everything else, is the note's own markdown.
 */

/** What rewriting a raw block needs from the export it is part of. */
export interface RawExport {
  /** The words a link is shared as. */
  readonly wordsOf: (link: WikiLinkOrEmbed) => string;
  /** The label a footnote is written with on the page. */
  readonly footnoteLabel: (label: string) => string;
  /**
   * Whether text reading like a reference to a footnote this block's note
   * does not define is escaped, so another note's footnote cannot answer it.
   */
  readonly escapeStrayFootnotes: boolean;
  readonly dropped: DroppedContent;
}

interface Edit extends MarkdownSpan {
  readonly text: string;
}

/** Where a page's link may go: the web, or an email. A note's path, or an app's, goes nowhere. */
export const REACHABLE = /^(?:https?:|mailto:)/i;
/** Where a page's image may come from: the web. */
export const ON_THE_WEB = /^https?:/i;

/** A raw block's markdown as the page should hold it, given the parts read in it. */
export function rawMarkdownForExport(
  markdown: string,
  parts: readonly RawPart[],
  context: RawExport,
): string {
  const ordered = [...parts].sort((a, b) => a.start - b.start || b.end - a.end);
  const edits = ordered.flatMap((part) => editsFor(part, markdown, context));
  return withEdits(markdown, edits);
}

function editsFor(part: RawPart, markdown: string, context: RawExport): Edit[] {
  const { dropped } = context;
  switch (part.kind) {
    case 'wiki-link':
      dropped.add(part.link.embed ? 'embed' : 'link', formatWikiLink(part.link));
      return [{ ...span(part), text: escapedForMarkdown(context.wordsOf(part.link)) }];
    case 'image':
      return imageEdits(part, dropped);
    case 'link':
      return linkEdits(part, dropped);
    case 'definition':
      if (!REACHABLE.test(part.url)) dropped.add('link', part.url);
      return [{ ...span(part), text: '' }];
    case 'footnote-label':
      return footnoteEdits(part, context);
    case 'html':
      return htmlEdits(part, markdown, dropped);
    case 'block-id':
      dropped.add('block-id', part.id);
      return [{ ...span(part), text: '' }];
    case 'quote-opening':
      return calloutOpening(part, markdown, dropped);
    case 'footnote-definition':
      return [];
  }
}

const span = ({ start, end }: MarkdownSpan): MarkdownSpan => ({ start, end });

/** An image on the web stays, written in place if it was a reference; any other is named. */
function imageEdits(part: Extract<RawPart, { kind: 'image' }>, dropped: DroppedContent): Edit[] {
  if (ON_THE_WEB.test(part.url)) {
    if (!part.reference) return [];
    const alt = escapedForMarkdown(part.alt);
    return [{ ...span(part), text: `![${alt}](${destination(part.url, part.title)})` }];
  }
  dropped.add('image', part.url);
  return [{ ...span(part), text: escapedForMarkdown(imageWords(part.alt, part.url)) }];
}

/** What an image the page cannot show reads as: its alt text, else its address. */
export function imageWords(alt: string, url: string): string {
  return `[Image: ${unlinkable(alt.trim() === '' ? url : alt.trim())}]`;
}

/**
 * A link the page can follow stays, written in place if it was a reference,
 * so no definition is needed and none from another note can answer it. Any
 * other link is its words.
 */
function linkEdits(part: Extract<RawPart, { kind: 'link' }>, dropped: DroppedContent): Edit[] {
  const { words } = part;
  if (REACHABLE.test(part.url)) {
    if (!part.reference) return [];
    return [{ start: words.end, end: part.end, text: `](${destination(part.url, part.title)})` }];
  }
  dropped.add('link', part.url);
  return [
    { start: part.start, end: words.start, text: '' },
    { start: words.end, end: part.end, text: '' },
  ];
}

/** A link's destination as markdown writes it, in angle brackets when it must be. */
function destination(url: string, title: string | null): string {
  const address = url === '' || /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, '\\$&')}>` : url;
  return title === null ? address : `${address} "${title.replace(/["\\]/g, '\\$&')}"`;
}

function footnoteEdits(
  part: Extract<RawPart, { kind: 'footnote-label' }>,
  context: RawExport,
): Edit[] {
  if (!part.defined) {
    // The `[` of `[^label]`, two before the label: escaped, it is text on any page.
    const bracket = part.start - 2;
    return context.escapeStrayFootnotes ? [{ start: bracket, end: bracket, text: '\\' }] : [];
  }
  const label = context.footnoteLabel(part.label);
  return label === part.label ? [] : [{ ...span(part), text: label }];
}

const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

/**
 * HTML: each comment gone — one never closed hides the rest of its block, as
 * it does in the note — and an `<img>` or `<a>` outside them held to the rules
 * any image or link is.
 */
function htmlEdits(part: MarkdownSpan, markdown: string, dropped: DroppedContent): Edit[] {
  const edits: Edit[] = [];
  let at = part.start;
  while (at < part.end) {
    const open = markdown.indexOf(COMMENT_OPEN, at);
    const opens = open !== -1 && open < part.end;
    edits.push(...tagEdits({ start: at, end: opens ? open : part.end }, markdown, dropped));
    if (!opens) break;
    const close = markdown.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
    const end = close === -1 || close >= part.end ? part.end : close + COMMENT_CLOSE.length;
    dropped.add('comment', markdown.slice(open, end));
    edits.push({ start: open, end, text: '' });
    at = end;
  }
  return edits;
}

const IMG_TAG = /<img\b[^>]*>/gi;
const A_TAG = /<a\b[^>]*>/gi;

function tagEdits(region: MarkdownSpan, markdown: string, dropped: DroppedContent): Edit[] {
  const html = markdown.slice(region.start, region.end);
  const edits: Edit[] = [];
  for (const tag of html.matchAll(IMG_TAG)) {
    const src = attributeOf(tag[0], 'src');
    if (src === null || ON_THE_WEB.test(src.value)) continue;
    dropped.add('image', src.value);
    const words = imageWords(attributeOf(tag[0], 'alt')?.value ?? '', src.value);
    const start = region.start + tag.index;
    edits.push({ start, end: start + tag[0].length, text: escapedForMarkdown(words) });
  }
  for (const tag of html.matchAll(A_TAG)) {
    const href = attributeOf(tag[0], 'href');
    if (href === null || REACHABLE.test(href.value)) continue;
    dropped.add('link', href.value);
    const start = region.start + tag.index + href.start;
    edits.push({ start, end: start + href.length, text: '' });
  }
  return edits;
}

/** An attribute of a tag: its value, and where the whole attribute, the space before it included, is. */
function attributeOf(
  tag: string,
  name: string,
): { value: string; start: number; length: number } | null {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const found = pattern.exec(tag);
  if (found === null) return null;
  const value = found[1] ?? found[2] ?? found[3] ?? '';
  return { value, start: found.index, length: found[0].length };
}

/**
 * A callout's marker, where a quote opens with one, as the bold name a
 * converted callout gets: `> [!warning] Mind the gap` is `> **Warning:** Mind the gap`.
 */
function calloutOpening(part: MarkdownSpan, markdown: string, dropped: DroppedContent): Edit[] {
  const newline = markdown.indexOf('\n', part.start);
  const lineEnd = newline === -1 || newline > part.end ? part.end : newline;
  const line = markdown.slice(part.start, lineEnd).trimEnd();
  const marker = parseCalloutMarker(line);
  if (marker === null) return [];
  if (marker.fold !== null) dropped.add('callout-fold', `[!${marker.kind}]${marker.fold}`);
  const markerLength = line.length - (marker.title?.length ?? 0);
  return [{ start: part.start, end: part.start + markerLength, text: calloutHeading(marker) }];
}

/** The name a callout opens with on the page. */
export function calloutName(marker: CalloutMarker): string {
  return calloutLabel({ ...marker, title: null });
}

function calloutHeading(marker: CalloutMarker): string {
  const name = escapedForMarkdown(calloutName(marker));
  return marker.title === null ? `**${name}**` : `**${name}:** `;
}

/**
 * Words dropped into markdown, escaped so they read as the words they are,
 * wherever they land: no emphasis, link, code or HTML in them, and nothing a
 * line could open with — a list's marker, a quote, a heading or its
 * underline — as remark escapes them in any other block.
 */
export function escapedForMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|~&#!]/g, '\\$&')
    .replace(/^[-+=]/, '\\$&')
    .replace(/^(\d{1,9})([.)])/, '$1\\$2');
}

const WORD_JOINER = '\u2060';

/**
 * Words that cannot become a link: a word joiner, which no one sees, after
 * `www` and a web address's `:`, and before an email's `@`, where GFM would
 * otherwise link them on the page.
 */
export function unlinkable(words: string): string {
  return words
    .replace(/\b(www)(?=\.)/gi, `$1${WORD_JOINER}`)
    .replace(/\b(https?:)(?=\/\/)/gi, `$1${WORD_JOINER}`)
    .replace(/@/g, `${WORD_JOINER}@`);
}

function withEdits(markdown: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  let written = '';
  for (const edit of ordered) {
    if (edit.start < cursor) {
      throw new Error(`Export edits overlap at ${edit.start}: the markdown reader's parts nest`);
    }
    written += markdown.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return written + markdown.slice(cursor);
}
