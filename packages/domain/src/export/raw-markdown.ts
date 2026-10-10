import { trailingBlockAnchor } from '../markdown/block-anchor.ts';
import { calloutLabel, parseCalloutMarker, type CalloutMarker } from '../markdown/callout.ts';
import { formatWikiLink, type WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import { scanMarkdown, type FenceSpan } from '../markdown/wikilink-spans.ts';
import type { DroppedContent } from './export-drops.ts';

/*
 * Markdown the editor does not model — a block with a footnote, inline HTML or
 * a comment in it — is exported as its own text (P32-07), with what is
 * Atlas's alone in it rewritten where it stands, read by the grammar the
 * editor reads: each link as its words, each comment gone, each id at the end
 * of a line gone, and a callout that opens the block as its name in bold.
 * Code is left as it is. Everything else is the note's own markdown.
 */

/** What rewriting a raw block needs from the export it is part of. */
export interface RawExport {
  /** The words a link is shared as. */
  readonly wordsOf: (link: WikiLinkOrEmbed) => string;
  readonly dropped: DroppedContent;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** A raw block's markdown as the page should hold it. */
export function rawMarkdownForExport(markdown: string, context: RawExport): string {
  const { links, comments, fences } = scanMarkdown(markdown);
  const edits: Edit[] = [...calloutOpening(markdown, context.dropped)];
  for (const { start, end, link } of links) {
    context.dropped.add(link.embed ? 'embed' : 'link', formatWikiLink(link));
    edits.push({ start, end, text: escapedForMarkdown(context.wordsOf(link)) });
  }
  for (const { start, end } of comments) {
    context.dropped.add('comment', markdown.slice(start, end));
    edits.push({ start, end, text: '' });
  }
  edits.push(...lineEndIds(markdown, { fences, edits, dropped: context.dropped }));
  return withEdits(markdown, edits);
}

/** Markdown's punctuation in `text` escaped, so words dropped into markdown read as words. */
export function escapedForMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|~&#!]/g, '\\$&');
}

const QUOTE_OPENING = /^ {0,3}>[ \t]?/;

/**
 * A callout's marker, where the block opens with one, as the bold name a
 * converted callout gets: `> [!warning] Mind the gap` is `> **Warning:** Mind the gap`.
 */
function calloutOpening(markdown: string, dropped: DroppedContent): Edit[] {
  const lineEnd = markdown.search(/\r?\n|$/);
  const quote = QUOTE_OPENING.exec(markdown.slice(0, lineEnd));
  if (quote === null) return [];
  const rest = markdown.slice(quote[0].length, lineEnd).trimEnd();
  const marker = parseCalloutMarker(rest);
  if (marker === null) return [];
  if (marker.fold !== null) dropped.add('callout-fold', rest);
  const markerLength = rest.length - (marker.title?.length ?? 0);
  const start = quote[0].length;
  return [{ start, end: start + markerLength, text: calloutHeading(marker) }];
}

/** The bold name a callout opens with on the page, ready for its title to follow. */
export function calloutName(marker: CalloutMarker): string {
  return calloutLabel({ ...marker, title: null });
}

function calloutHeading(marker: CalloutMarker): string {
  const name = escapedForMarkdown(calloutName(marker));
  return marker.title === null ? `**${name}**` : `**${name}:** `;
}

/** The id ending each line outside code and outside anything already rewritten. */
function lineEndIds(
  markdown: string,
  {
    fences,
    edits,
    dropped,
  }: { fences: readonly FenceSpan[]; edits: readonly Edit[]; dropped: DroppedContent },
): Edit[] {
  const found: Edit[] = [];
  const covered = (at: number) =>
    [...fences, ...edits].some((span) => span.start <= at && at < span.end);
  let start = 0;
  for (const line of markdown.split('\n')) {
    const anchor = trailingBlockAnchor(line);
    const end = start + line.replace(/[ \t\r]+$/, '').length;
    if (anchor !== null && !covered(start + anchor.start)) {
      dropped.add('block-id', anchor.id);
      found.push({ start: start + anchor.start, end, text: '' });
    }
    start += line.length + 1;
  }
  return found;
}

function withEdits(markdown: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let written = '';
  for (const edit of ordered) {
    written += markdown.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return written + markdown.slice(cursor);
}
