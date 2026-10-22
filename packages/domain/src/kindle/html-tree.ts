import { NAMED_ENTITIES } from './html-entities.ts';

/**
 * A small, forgiving reader of HTML into a tree, enough to pick values out of
 * a page someone else wrote (Amazon's Kindle notebook). Pure: no DOM, which
 * the domain may not depend on, and nothing is ever run.
 *
 * It is not a browser's parser and does not try to be. It keeps elements,
 * their attributes and their text; drops comments, doctypes, scripts and
 * styles; closes void elements on their own; and reads a stray end tag as
 * closing the nearest open element of its name, or as nothing when there is
 * none. That is enough for a page whose values sit in ids, classes and hidden
 * inputs, and a page that is not that page reads as one that is missing them.
 */

export interface HtmlElement {
  readonly tag: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly HtmlNode[];
}

export interface HtmlText {
  readonly text: string;
}

export type HtmlNode = HtmlElement | HtmlText;

interface OpenElement {
  readonly tag: string;
  readonly attributes: Map<string, string>;
  readonly children: HtmlNode[];
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Elements whose content is text up to their own end tag, never markup. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
/** Raw-text elements whose content is code rather than words: dropped. */
const DROPPED_ELEMENTS = new Set(['script', 'style']);

const MAX_CODE_POINT = 0x10ffff;

/**
 * Deeper than any real page nests. Past it, an element is kept but nothing
 * is put inside it, so a page built to be absurdly deep cannot run the
 * queries, which walk the tree recursively, out of stack.
 */
export const MAX_HTML_DEPTH = 256;

/**
 * What a numeric reference in the old Windows range (`&#146;`, `&#150;`) stands
 * for. Pages written for the 1990s browsers still use them, and browsers read
 * them as these characters, not as the control codes the numbers name.
 */
const WINDOWS_1252: Readonly<Record<number, string>> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;

function characterOf(code: number): string | null {
  const windows = WINDOWS_1252[code];
  if (windows !== undefined) return windows;
  const surrogate = code >= FIRST_SURROGATE && code <= LAST_SURROGATE;
  return code > 0 && code <= MAX_CODE_POINT && !surrogate ? String.fromCodePoint(code) : null;
}

/**
 * `&amp;`, `&eacute;`, `&#39;`, `&#x2019;` and the like as the characters they
 * stand for (every named reference HTML5 has, in its own case); one that is
 * unknown, or stands for no character, is left as written.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      return characterOf(Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)) ?? whole;
    }
    return NAMED_ENTITIES.get(body) ?? whole;
  });
}

// Sticky, so each is matched where the reader stands rather than on a copy
// of the rest of the page: a page is read in one pass, however many tags.
const TAG_NAME = /[a-zA-Z][a-zA-Z0-9-]*/y;
const TAG_CLOSE = /\s*(\/?)>/y;
const ATTRIBUTE = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
// A run of white space and the one character after it: junk in a tag is
// stepped over with the white space before it, so a long run is read once.
const JUNK = /\s*[\s\S]/y;

function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

interface StartTag {
  readonly tag: string;
  readonly attributes: Map<string, string>;
  readonly selfClosing: boolean;
  /** Where the source continues after the tag's `>`. */
  readonly end: number;
}

/** What a start tag that never ends is: the rest of the page is inside it. */
const UNTERMINATED = 'unterminated';

/**
 * The start tag at `at` (just past its `<`); null when what follows is not
 * one, and {@link UNTERMINATED} when the page ends before the tag does.
 */
function readStartTag(html: string, at: number): StartTag | typeof UNTERMINATED | null {
  const name = matchAt(TAG_NAME, html, at);
  if (name === null) return null;
  const attributes = new Map<string, string>();
  let cursor = at + name[0].length;
  while (cursor < html.length) {
    const close = matchAt(TAG_CLOSE, html, cursor);
    if (close !== null) {
      const end = cursor + close[0].length;
      return { tag: name[0].toLowerCase(), attributes, selfClosing: close[1] === '/', end };
    }
    const attribute = matchAt(ATTRIBUTE, html, cursor);
    if (attribute === null) {
      // Junk inside a tag (a stray `/` or quote): step over it, as a browser does.
      cursor += matchAt(JUNK, html, cursor)?.[0].length ?? 1;
      continue;
    }
    const key = (attribute[1] ?? '').toLowerCase();
    if (!attributes.has(key)) {
      attributes.set(key, decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''));
    }
    cursor += attribute[0].length;
  }
  return UNTERMINATED;
}

class TreeBuilder {
  private readonly root: OpenElement = { tag: '#root', attributes: new Map(), children: [] };
  private readonly open: OpenElement[] = [this.root];
  tooDeep = false;

  text(text: string): void {
    if (text.length > 0) this.top().children.push({ text: decodeEntities(text) });
  }

  start(tag: StartTag): void {
    const element: OpenElement = { tag: tag.tag, attributes: tag.attributes, children: [] };
    this.top().children.push(element);
    const opens = !tag.selfClosing && !VOID_ELEMENTS.has(tag.tag);
    if (!opens) return;
    if (this.open.length < MAX_HTML_DEPTH) this.open.push(element);
    else this.tooDeep = true;
  }

  /** Closes the nearest open element named `tag`; a stray end tag closes nothing. */
  end(tag: string): void {
    const at = this.open.map((element) => element.tag).lastIndexOf(tag);
    if (at > 0) this.open.length = at;
  }

  finish(): HtmlElement {
    return this.root;
  }

  private top(): OpenElement {
    return this.open[this.open.length - 1] ?? this.root;
  }
}

/** Where a comment, doctype or processing instruction at `at` ends, past its `>`. */
function skipDeclaration(html: string, at: number): number {
  if (html.startsWith('<!--', at)) {
    const close = html.indexOf('-->', at + 4);
    return close < 0 ? html.length : close + 3;
  }
  const close = html.indexOf('>', at);
  return close < 0 ? html.length : close + 1;
}

/** The raw text of a script, style, title or textarea, and where its end tag ends. */
function readRawText(html: string, from: number, tag: string): { text: string; end: number } {
  const pattern = new RegExp(`</${tag}\\s*>`, 'gi');
  pattern.lastIndex = from;
  const close = pattern.exec(html);
  if (close === null) return { text: html.slice(from), end: html.length };
  return { text: html.slice(from, close.index), end: close.index + close[0].length };
}

/** A page read into a tree, and whether it nested deeper than a page may. */
export interface HtmlDocument {
  readonly tree: HtmlElement;
  /**
   * Some element was nested past {@link MAX_HTML_DEPTH}, so what is inside it
   * sits flat in the tree: a reader that must not mistake that for absence
   * refuses the page.
   */
  readonly tooDeep: boolean;
}

/** Reads `html` into a tree under a root element named `#root`, and says whether it was too deep. */
export function parseHtmlDocument(html: string): HtmlDocument {
  const builder = new TreeBuilder();
  let cursor = 0;
  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt < 0) {
      builder.text(html.slice(cursor));
      break;
    }
    builder.text(html.slice(cursor, lt));
    cursor = readMarkup(html, lt, builder);
  }
  return { tree: builder.finish(), tooDeep: builder.tooDeep };
}

/** Reads `html` into a tree under a root element named `#root`. */
export function parseHtml(html: string): HtmlElement {
  return parseHtmlDocument(html).tree;
}

/**
 * A tag that never ends takes the rest of the page as its text, in one step.
 * Looking again for its end from each later `<` would read the page once per
 * `<`, and a page of eight megabytes of them is some 10^11 steps.
 */
function restAsText(html: string, from: number, tree: TreeBuilder): number {
  tree.text(html.slice(from));
  return html.length;
}

/** Reads the markup at `lt` into `tree`; where the source continues. */
function readMarkup(html: string, lt: number, tree: TreeBuilder): number {
  const next = html[lt + 1];
  if (next === '!' || next === '?') return skipDeclaration(html, lt);
  if (next === '/') {
    const name = matchAt(TAG_NAME, html, lt + 2);
    if (name === null) {
      tree.text('</');
      return lt + 2;
    }
    const close = html.indexOf('>', lt);
    if (close < 0) return restAsText(html, lt, tree);
    tree.end(name[0].toLowerCase());
    return close + 1;
  }
  const tag = readStartTag(html, lt + 1);
  if (tag === UNTERMINATED) return restAsText(html, lt, tree);
  if (tag === null) {
    tree.text('<');
    return lt + 1;
  }
  tree.start(tag);
  if (!RAW_TEXT_ELEMENTS.has(tag.tag) || tag.selfClosing) return tag.end;
  const raw = readRawText(html, tag.end, tag.tag);
  if (!DROPPED_ELEMENTS.has(tag.tag)) tree.text(raw.text);
  tree.end(tag.tag);
  return raw.end;
}

export function isElement(node: HtmlNode): node is HtmlElement {
  return 'tag' in node;
}

/** Every element under `element`, in document order, that `matches`. */
export function findAll(
  element: HtmlElement,
  matches: (candidate: HtmlElement) => boolean,
): HtmlElement[] {
  const found: HtmlElement[] = [];
  const visit = (parent: HtmlElement) => {
    for (const child of parent.children) {
      if (!isElement(child)) continue;
      if (matches(child)) found.push(child);
      visit(child);
    }
  };
  visit(element);
  return found;
}

/** The first element under `element`, in document order, that `matches`; null when none does. */
export function findFirst(
  element: HtmlElement,
  matches: (candidate: HtmlElement) => boolean,
): HtmlElement | null {
  for (const child of element.children) {
    if (!isElement(child)) continue;
    if (matches(child)) return child;
    const inner = findFirst(child, matches);
    if (inner !== null) return inner;
  }
  return null;
}

export function classesOf(element: HtmlElement): string[] {
  return (element.attributes.get('class') ?? '').split(/\s+/).filter((name) => name.length > 0);
}

export const withClass =
  (...names: string[]) =>
  (element: HtmlElement): boolean => {
    const classes = classesOf(element);
    return names.every((name) => classes.includes(name));
  };

export const withId =
  (id: string) =>
  (element: HtmlElement): boolean =>
    element.attributes.get('id') === id;

export const withTag =
  (tag: string) =>
  (element: HtmlElement): boolean =>
    element.tag === tag;

/** Stands for a `<br>` while white space is collapsed: a newline in the text is not one. */
const LINE_BREAK = '\n';

/**
 * The words in `element` as a person reads them: `<br>` as a line break,
 * every other run of white space (a non-breaking space included) as one
 * space, each line trimmed.
 */
export function textOf(element: HtmlElement): string {
  const pieces: string[] = [];
  const visit = (parent: HtmlElement) => {
    for (const child of parent.children) {
      // A line break in the source is white space; only `<br>` breaks a line.
      if (!isElement(child)) pieces.push(child.text.replace(/[\s\u00a0]+/g, ' '));
      else if (child.tag === 'br') pieces.push(LINE_BREAK);
      else visit(child);
    }
  };
  visit(element);
  return pieces
    .join('')
    .split(LINE_BREAK)
    .map((line) => line.replace(/ +/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
