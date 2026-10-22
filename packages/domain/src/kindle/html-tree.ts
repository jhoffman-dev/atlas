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

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

const MAX_CODE_POINT = 0x10ffff;

/**
 * Deeper than any real page nests. Past it, an element is kept but nothing
 * is put inside it, so a page built to be absurdly deep cannot run the
 * queries, which walk the tree recursively, out of stack.
 */
export const MAX_HTML_DEPTH = 256;

/** `&amp;`, `&#39;`, `&#x2019;` and the like as the characters they stand for; unknown ones as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// Sticky, so each is matched where the reader stands rather than on a copy
// of the rest of the page: a page is read in one pass, however many tags.
const TAG_NAME = /[a-zA-Z][a-zA-Z0-9-]*/y;
const TAG_CLOSE = /\s*(\/?)>/y;
const ATTRIBUTE = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;

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

/** The start tag at `at` (just past its `<`), or null when what follows is not one. */
function readStartTag(html: string, at: number): StartTag | null {
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
      cursor += 1;
      continue;
    }
    const key = (attribute[1] ?? '').toLowerCase();
    if (!attributes.has(key)) {
      attributes.set(key, decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''));
    }
    cursor += attribute[0].length;
  }
  return null;
}

class TreeBuilder {
  private readonly root: OpenElement = { tag: '#root', attributes: new Map(), children: [] };
  private readonly open: OpenElement[] = [this.root];

  text(text: string): void {
    if (text.length > 0) this.top().children.push({ text: decodeEntities(text) });
  }

  start(tag: StartTag): void {
    const element: OpenElement = { tag: tag.tag, attributes: tag.attributes, children: [] };
    this.top().children.push(element);
    const opens = !tag.selfClosing && !VOID_ELEMENTS.has(tag.tag);
    if (opens && this.open.length < MAX_HTML_DEPTH) this.open.push(element);
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

/** Reads `html` into a tree under a root element named `#root`. */
export function parseHtml(html: string): HtmlElement {
  const tree = new TreeBuilder();
  let cursor = 0;
  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt < 0) {
      tree.text(html.slice(cursor));
      break;
    }
    tree.text(html.slice(cursor, lt));
    cursor = readMarkup(html, lt, tree);
  }
  return tree.finish();
}

/** Reads the markup at `lt` into `tree`; where the source continues. */
function readMarkup(html: string, lt: number, tree: TreeBuilder): number {
  const next = html[lt + 1];
  if (next === '!' || next === '?') return skipDeclaration(html, lt);
  if (next === '/') {
    const name = matchAt(TAG_NAME, html, lt + 2);
    const close = html.indexOf('>', lt);
    if (name === null || close < 0) {
      tree.text('</');
      return lt + 2;
    }
    tree.end(name[0].toLowerCase());
    return close + 1;
  }
  const tag = readStartTag(html, lt + 1);
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
