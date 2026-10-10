import { calloutLabel, parseCalloutMarker, type CalloutMarker } from '../markdown/callout.ts';
import { formatWikiLink, type WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import type { DroppedContent, ExportDropKind } from './export-drops.ts';
import type { MarkdownSpan, RawPart } from './raw-parts.ts';

/*
 * Markdown the editor does not model — a block with a footnote, inline HTML or
 * a comment in it — is exported as its own text (P32-07), rewritten in place
 * by the same rules as every other block, at the parts the markdown reader
 * found in it: each wiki link as its words; an image or a link the page cannot
 * reach as its words, and a reference as the link it stands for; each
 * comment, closed or not, gone; and each callout's marker as its name in
 * bold. Code, and everything else, is the note's own markdown.
 *
 * Text rewritten in place can read as something else: an HTML block that
 * loses its opening tag is a paragraph, and the link it held comes alive. So
 * the rewrite is read again, and kept only if it has the same blocks and goes
 * nowhere the page cannot follow. Otherwise the block is shared as its words
 * alone, every mark escaped, and that is listed too.
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
  /** Reads markdown as the parts were read: what the rewrite is checked by. */
  readonly reread: (markdown: string) => readonly RawPart[];
  readonly dropped: DroppedContent;
}

interface Edit extends MarkdownSpan {
  readonly text: string;
}

type Drop = readonly [ExportDropKind, string];

/** What one part asks of the rewrite: its edits, and what they leave out. */
interface Plan {
  readonly edits: readonly Edit[];
  readonly drops: readonly Drop[];
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
  const { edits, drops } = acceptedPlans(markdown, parts, context);
  for (const [kind, item] of drops) context.dropped.add(kind, item);
  const written = withEdits(markdown, edits);
  if (readsTheSame({ markdown, parts }, { markdown: written, parts: context.reread(written) })) {
    return written;
  }
  context.dropped.add('formatting', firstLineOf(markdown));
  return asWords(written);
}

/**
 * Each part's plan, outermost first, less any whose edits would cut into one
 * already taken — a link inside a callout's marker, say. What a skipped part
 * would have rewritten is still checked by the second reading.
 */
function acceptedPlans(
  markdown: string,
  parts: readonly RawPart[],
  context: RawExport,
): { edits: Edit[]; drops: Drop[] } {
  const ordered = [...parts].sort((a, b) => a.start - b.start || b.end - a.end);
  const edits: Edit[] = [];
  const drops: Drop[] = [];
  for (const part of ordered) {
    const plan = planFor(part, { markdown, context, parts: ordered });
    if (plan.edits.some((edit) => edits.some((taken) => overlap(edit, taken)))) continue;
    edits.push(...plan.edits);
    drops.push(...plan.drops);
  }
  return { edits, drops };
}

/** Whether two edits touch the same bytes; an insertion only where it falls strictly inside the other. */
function overlap(a: Edit, b: Edit): boolean {
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

const NOTHING: Plan = { edits: [], drops: [] };

interface Block {
  readonly markdown: string;
  readonly context: RawExport;
  readonly parts: readonly RawPart[];
}

function planFor(part: RawPart, block: Block): Plan {
  switch (part.kind) {
    case 'wiki-link':
      return {
        edits: [{ ...span(part), text: escapedForMarkdown(block.context.wordsOf(part.link)) }],
        drops: [[part.link.embed ? 'embed' : 'link', formatWikiLink(part.link)]],
      };
    case 'image':
      return imagePlan(part);
    case 'link':
      return linkPlan(part, block);
    case 'definition':
      return {
        edits: [{ ...span(part), text: '' }],
        drops: REACHABLE.test(part.url) ? [] : [['link', part.url]],
      };
    case 'footnote-label':
      return footnotePlan(part, block.context);
    case 'html':
      return htmlPlan(part, block.markdown);
    case 'quote-opening':
      return calloutPlan(part, block.markdown);
    case 'footnote-definition':
    case 'block':
      return NOTHING;
  }
}

const span = ({ start, end }: MarkdownSpan): MarkdownSpan => ({ start, end });

/** An image on the web stays, written in place if it was a reference; any other is named. */
function imagePlan(part: Extract<RawPart, { kind: 'image' }>): Plan {
  if (ON_THE_WEB.test(part.url)) {
    if (!part.reference) return NOTHING;
    const alt = escapedForMarkdown(part.alt);
    const text = `![${alt}](${destination(part.url, part.title)})`;
    return { edits: [{ ...span(part), text }], drops: [] };
  }
  const text = escapedForMarkdown(imageWords(part.alt, part.url));
  return { edits: [{ ...span(part), text }], drops: [['image', part.url]] };
}

/** What an image the page cannot show reads as: its alt text, else its address. */
export function imageWords(alt: string, url: string): string {
  return `[Image: ${unlinkable(alt.trim() === '' ? url : alt.trim())}]`;
}

/**
 * A link the page can follow stays, written in place if it was a reference,
 * so no definition is needed and none from another note can answer it. Any
 * other link is its words, kept as written — but never opening a block on
 * their line, and never a link of their own.
 */
function linkPlan(part: Extract<RawPart, { kind: 'link' }>, block: Block): Plan {
  const { words } = part;
  if (REACHABLE.test(part.url)) {
    if (!part.reference) return NOTHING;
    const text = `](${destination(part.url, part.title)})`;
    return { edits: [{ start: words.end, end: part.end, text }], drops: [] };
  }
  return {
    edits: [
      { start: part.start, end: words.start, text: '' },
      ...wordsKeptAsWords(part, block),
      { start: words.end, end: part.end, text: '' },
    ],
    drops: [['link', part.url]],
  };
}

/**
 * What keeps a link's words words once its brackets are gone: a backslash
 * before anything they would open their line with, and a word joiner where
 * GFM would link them — outside code, and outside anything else read in them.
 */
function wordsKeptAsWords(part: Extract<RawPart, { kind: 'link' }>, block: Block): Edit[] {
  const { words } = part;
  const text = block.markdown.slice(words.start, words.end);
  const inner = block.parts.filter(
    (other) => other !== part && other.start >= words.start && other.end <= words.end,
  );
  const opener = opensALine(block.markdown, part.start) ? lineOpenerAt(text) : null;
  const insertions = [
    ...(opener === null ? [] : [{ at: words.start + opener, text: '\\' }]),
    ...linkablePoints(text, codeSpansIn(text)).map((at) => ({
      at: words.start + at,
      text: WORD_JOINER,
    })),
  ];
  return insertions
    .filter(({ at }) => !inner.some((other) => other.start < at && at < other.end))
    .map(({ at, text: inserted }) => ({ start: at, end: at, text: inserted }));
}

/** Whether only a line's quote and list markers, and spaces, come before `at`. */
function opensALine(markdown: string, at: number): boolean {
  const lineStart = markdown.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*$/.test(markdown.slice(lineStart, at));
}

/**
 * A link's destination as markdown writes it, in angle brackets when it must
 * be, its `|` escaped so a table cell holding it stays one cell.
 */
function destination(url: string, title: string | null): string {
  const piped = (text: string) => text.replace(/\|/g, '\\|');
  const bare = /[\s()<>]/.test(url) || url === '';
  const address = bare ? `<${piped(url.replace(/[<>]/g, '\\$&'))}>` : piped(url);
  return title === null ? address : `${address} "${piped(title.replace(/["\\]/g, '\\$&'))}"`;
}

function footnotePlan(
  part: Extract<RawPart, { kind: 'footnote-label' }>,
  context: RawExport,
): Plan {
  if (!part.defined) {
    if (!context.escapeStrayFootnotes) return NOTHING;
    // The `[` of `[^label]`, two before the label: escaped, it is text on any page.
    const bracket = part.start - 2;
    return { edits: [{ start: bracket, end: bracket, text: '\\' }], drops: [] };
  }
  const label = context.footnoteLabel(part.label);
  return label === part.label ? NOTHING : { edits: [{ ...span(part), text: label }], drops: [] };
}

const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

/**
 * HTML: each comment gone — one never closed hides the rest of its block, as
 * it does in the note — and an `<img>` or `<a>` outside them held to the rules
 * any image or link is.
 */
function htmlPlan(part: MarkdownSpan, markdown: string): Plan {
  const edits: Edit[] = [];
  const drops: Drop[] = [];
  let at = part.start;
  for (const comment of commentsIn(part, markdown)) {
    const tags = tagPlan({ start: at, end: comment.start }, markdown);
    edits.push(...tags.edits, { ...comment, text: '' });
    drops.push(...tags.drops, ['comment', markdown.slice(comment.start, comment.end)]);
    at = comment.end;
  }
  const tags = tagPlan({ start: at, end: part.end }, markdown);
  return { edits: [...edits, ...tags.edits], drops: [...drops, ...tags.drops] };
}

/** Each comment in the span: to its `-->`, or to the span's end when it has none. */
function commentsIn(part: MarkdownSpan, markdown: string): MarkdownSpan[] {
  const found: MarkdownSpan[] = [];
  let at = part.start;
  for (;;) {
    const open = markdown.indexOf(COMMENT_OPEN, at);
    if (open === -1 || open >= part.end) return found;
    const close = markdown.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
    const end = close === -1 || close >= part.end ? part.end : close + COMMENT_CLOSE.length;
    found.push({ start: open, end });
    at = end;
  }
}

function tagPlan(region: MarkdownSpan, markdown: string): Plan {
  const tags = unreachableTags(markdown.slice(region.start, region.end));
  return {
    edits: tags.map((tag) => ({
      start: region.start + tag.start,
      end: region.start + tag.end,
      text: tag.text,
    })),
    drops: tags.map((tag) => [tag.kind, tag.address] as const),
  };
}

interface UnreachableTag extends MarkdownSpan {
  /** What replaces it. */
  readonly text: string;
  readonly kind: 'image' | 'link';
  readonly address: string;
}

const IMG_TAG = /<img\b[^>]*>/gi;
const A_TAG = /<a\b[^>]*>/gi;

/** The `<img>` and `<a href>` in HTML that go where the page cannot follow, and what replaces each. */
function unreachableTags(html: string): UnreachableTag[] {
  const found: UnreachableTag[] = [];
  for (const tag of html.matchAll(IMG_TAG)) {
    const src = attributeOf(tag[0], 'src');
    if (src === null || ON_THE_WEB.test(src.value)) continue;
    const text = escapedForMarkdown(imageWords(attributeOf(tag[0], 'alt')?.value ?? '', src.value));
    const end = tag.index + tag[0].length;
    found.push({ start: tag.index, end, text, kind: 'image', address: src.value });
  }
  for (const tag of html.matchAll(A_TAG)) {
    const href = attributeOf(tag[0], 'href');
    if (href === null || REACHABLE.test(href.value)) continue;
    const start = tag.index + href.start;
    found.push({ start, end: start + href.length, text: '', kind: 'link', address: href.value });
  }
  return found;
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
function calloutPlan(part: MarkdownSpan, markdown: string): Plan {
  const newline = markdown.indexOf('\n', part.start);
  const lineEnd = newline === -1 || newline > part.end ? part.end : newline;
  const line = markdown.slice(part.start, lineEnd).trimEnd();
  const marker = parseCalloutMarker(line);
  if (marker === null) return NOTHING;
  const markerLength = line.length - (marker.title?.length ?? 0);
  return {
    edits: [{ start: part.start, end: part.start + markerLength, text: calloutHeading(marker) }],
    drops: marker.fold === null ? [] : [['callout-fold', `[!${marker.kind}]${marker.fold}`]],
  };
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
 * Whether a rewrite reads as the block it came from: the same blocks, at the
 * same depths — leaving out definitions and HTML of nothing but comments,
 * which a rewrite takes out on purpose — and nothing in it the page cannot
 * follow or must not show.
 */
function readsTheSame(
  before: { markdown: string; parts: readonly RawPart[] },
  after: { markdown: string; parts: readonly RawPart[] },
): boolean {
  const same = shapeOf(before).join(' ') === shapeOf(after).join(' ');
  return same && after.parts.every((part) => shareable(part, after.markdown));
}

function shapeOf({ markdown, parts }: { markdown: string; parts: readonly RawPart[] }): string[] {
  return parts.flatMap((part) => {
    if (part.kind !== 'block' || part.type === 'definition') return [];
    if (part.type === 'html' && onlyComments(markdown.slice(part.start, part.end))) return [];
    return [`${part.depth}:${part.type}`];
  });
}

const onlyComments = (html: string): boolean =>
  html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').trim() === '';

/** Whether a part of a rewrite may stand on the page as it is. */
function shareable(part: RawPart, markdown: string): boolean {
  switch (part.kind) {
    case 'wiki-link':
      return false;
    case 'image':
      return ON_THE_WEB.test(part.url);
    case 'link':
    case 'definition':
      return REACHABLE.test(part.url);
    case 'html': {
      const html = markdown.slice(part.start, part.end);
      return !html.includes(COMMENT_OPEN) && unreachableTags(html).length === 0;
    }
    default:
      return true;
  }
}

const firstLineOf = (markdown: string): string => markdown.trim().split(/\r?\n/)[0] ?? '';

/**
 * Markdown as its words alone: each line's indent taken off and every mark
 * escaped once — any escape it held read first — so nothing in it is a block,
 * a link or HTML on the page.
 */
function asWords(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => escapedForMarkdown(unlinkable(unescaped(line.trimStart()))))
    .join('\n');
}

/** Markdown's backslash escapes read: `\*` is `*`. */
const unescaped = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, '$1');

/**
 * Words dropped into markdown, escaped so they read as the words they are,
 * wherever they land: no emphasis, link, code or HTML in them, and nothing a
 * line could open with — a list's marker, a quote, a heading, its underline
 * or a fence — as remark escapes them in any other block.
 */
export function escapedForMarkdown(text: string): string {
  const escaped = text.replace(/[\\`*_[\]<>|~&#!]/g, '\\$&');
  const opener = lineOpenerAt(escaped);
  return opener === null ? escaped : `${escaped.slice(0, opener)}\\${escaped.slice(opener)}`;
}

/**
 * Where a backslash would stop `text` opening a block, were it to start a
 * line: before a list's, a quote's or a heading's marker, an underline or a
 * fence, or before the `.` or `)` of a number. Null when it would open none.
 */
function lineOpenerAt(text: string): number | null {
  if (/^(?:[>=+-]|#{1,6}(?=[ \t]|$)|\*(?=[ \t]|$)|`{3}|~{3})/.test(text)) return 0;
  const numbered = /^(\d{1,9})[.)](?=[ \t]|$)/.exec(text);
  return numbered === null ? null : (numbered[1] ?? '').length;
}

const WORD_JOINER = '\u2060';
/**
 * Where GFM would start a link in words: after `www` or `http(s):`, or at an
 * email's `@` — none where a word joiner already stands.
 */
const LINKABLE = /\b(?:www(?=\.)|https?:(?=\/\/))|(?<!\u2060)(?=@)/gi;

/**
 * Words that cannot become a link: a word joiner, which no one sees, after
 * `www` and a web address's `:`, and before an email's `@`, where GFM would
 * otherwise link them on the page.
 */
export function unlinkable(words: string): string {
  let written = '';
  let cursor = 0;
  for (const at of linkablePoints(words, [])) {
    written += `${words.slice(cursor, at)}${WORD_JOINER}`;
    cursor = at;
  }
  return written + words.slice(cursor);
}

/** Where a word joiner keeps words from becoming a link, outside the spans given. */
function linkablePoints(words: string, outside: readonly MarkdownSpan[]): number[] {
  return [...words.matchAll(LINKABLE)]
    .map((found) => found.index + found[0].length)
    .filter((at) => !outside.some((code) => code.start < at && at < code.end));
}

/** The code spans in markdown's words, roughly: a run of backticks to the next as long. */
function codeSpansIn(text: string): MarkdownSpan[] {
  return [...text.matchAll(/(`+)[\s\S]*?\1/g)].map((found) => ({
    start: found.index,
    end: found.index + found[0].length,
  }));
}

function withEdits(markdown: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  let written = '';
  for (const edit of ordered) {
    written += markdown.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return written + markdown.slice(cursor);
}
