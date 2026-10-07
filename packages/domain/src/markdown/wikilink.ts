import { wikiLinkSpans } from './wikilink-spans.ts';

/**
 * Obsidian-style links: `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`.
 *
 * The target is kept exactly as written. Resolving it to a file is a separate
 * concern, because the same text can match different notes in different vaults.
 */
export interface WikiLink {
  readonly target: string;
  readonly heading: string | null;
  readonly alias: string | null;
}

export type WikiLinkPiece =
  { readonly kind: 'text'; readonly value: string } | ({ readonly kind: 'wikiLink' } & WikiLink);

/**
 * Characters a link reads as its own syntax — a heading, a block, an alias,
 * the brackets — so a note whose name holds one cannot be linked to, in
 * Atlas or in Obsidian, which refuses them in a name for that reason.
 */
const LINK_SYNTAX = /[#^[\]|]/;

/** The first character in `name` that no `[[link]]` to it could hold, or null. */
export function linkBreakingCharacter(name: string): string | null {
  return LINK_SYNTAX.exec(name)?.[0] ?? null;
}

/** What a wiki link shows when it is not given an alias. */
export function wikiLinkLabel(link: WikiLink): string {
  if (link.alias !== null) return link.alias;
  return link.heading === null ? link.target : `${link.target}${link.heading}`;
}

/** A link or, written `![[…]]`, an embed: the linked file shown in place. */
export interface WikiLinkOrEmbed extends WikiLink {
  readonly embed: boolean;
}

/** Writes a link back in the form it is read in. */
export function formatWikiLink(link: WikiLink & { readonly embed?: boolean }): string {
  const heading = link.heading ?? '';
  const alias = link.alias === null ? '' : `|${link.alias}`;
  const bang = link.embed === true ? '!' : '';
  return `${bang}[[${link.target}${heading}${alias}]]`;
}

/**
 * Splits markdown into plain pieces and links, read by the one link grammar
 * the editor reads too (`wikiLinkSpans`): an escaped link, one broken over a
 * line, or one in code or a comment is text. Text containing no link comes
 * back as a single piece, so callers can treat the common case cheaply. A `!`
 * before a link stays in the text before it: see `splitWikiLinksAndEmbeds`.
 */
export function splitWikiLinks(text: string): WikiLinkPiece[] {
  const pieces: WikiLinkPiece[] = [];
  let cursor = 0;
  for (const { start, end, link } of wikiLinkSpans(text)) {
    const from = link.embed ? start + 1 : start;
    if (from > cursor) pieces.push({ kind: 'text', value: text.slice(cursor, from) });
    pieces.push({
      kind: 'wikiLink',
      target: link.target,
      heading: link.heading,
      alias: link.alias,
    });
    cursor = end;
  }
  if (cursor < text.length) pieces.push({ kind: 'text', value: text.slice(cursor) });
  return pieces;
}

export type WikiEmbedPiece =
  | { readonly kind: 'text'; readonly value: string }
  | ({ readonly kind: 'wikiLink' } & WikiLinkOrEmbed);

/**
 * `splitWikiLinks`, with a `!` directly before a link read as part of it: an
 * embed. The editor needs this so the `!` travels with the link rather than
 * sitting in the text before it, where it would be escaped on save. Kept apart
 * from `splitWikiLinks` because a property or relation written `![[x]]` is not
 * a relation. An escaped `!`, `\![[x]]`, is text before a link.
 */
export function splitWikiLinksAndEmbeds(text: string): WikiEmbedPiece[] {
  const pieces: WikiEmbedPiece[] = [];
  let cursor = 0;
  for (const { start, end, link } of wikiLinkSpans(text)) {
    if (start > cursor) pieces.push({ kind: 'text', value: text.slice(cursor, start) });
    pieces.push({ kind: 'wikiLink', ...link });
    cursor = end;
  }
  if (cursor < text.length) pieces.push({ kind: 'text', value: text.slice(cursor) });
  return pieces;
}
