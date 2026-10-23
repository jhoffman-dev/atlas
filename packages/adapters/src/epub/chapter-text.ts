/*
 * A chapter's text as the EPUB reader counts it (#505): the words of its
 * body in document order, a line break where a block of text (a paragraph,
 * a heading, a list item) begins or ends, and nothing a reader does not
 * show — scripts, styles, the head. Every place the reader names in a
 * chapter — a selection, a highlight, a match of find — is an offset of
 * this text, and is turned into a DOM position and back here, on the parsed
 * chapter or on its copy in the frame, which have the same nodes.
 */

/** Elements whose text is never shown. */
const UNSHOWN = new Set(['head', 'script', 'style', 'template', 'noscript', 'title']);

/** Elements that start a block of their own: their text is set apart from what is around it. */
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

/** One text node of the chapter, and where its words begin in the chapter's text. */
interface Run {
  readonly node: Text;
  readonly start: number;
}

/** A chapter's text, and the text nodes it was read from. */
export interface ChapterText {
  readonly text: string;
  readonly runs: readonly Run[];
}

/** The text of the chapter `doc` holds, read from its body (or its root, for a chapter with none). */
export function chapterText(doc: Document): ChapterText {
  const root = bodyOf(doc);
  const runs: Run[] = [];
  let text = '';
  const breakLine = () => {
    if (text !== '' && !text.endsWith('\n')) text += '\n';
  };
  const walk = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      const value = (node as Text).data;
      if (value === '') return;
      runs.push({ node: node as Text, start: text.length });
      text += value;
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const name = (node as Element).localName.toLowerCase();
    if (UNSHOWN.has(name)) return;
    const block = BLOCKS.has(name);
    if (block) breakLine();
    for (let child = node.firstChild; child !== null; child = child.nextSibling) walk(child);
    if (block) breakLine();
  };
  walk(root);
  return { text, runs };
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function bodyOf(doc: Document): Node {
  const body = doc.body ?? doc.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'body')[0];
  return body ?? doc.documentElement;
}

/** The DOM position of offset `offset` of the chapter's text: within the run it falls in, or at the next one's start. */
export function positionAt(
  chapter: ChapterText,
  offset: number,
): { node: Text; offset: number } | null {
  const { runs } = chapter;
  if (runs.length === 0) return null;
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((runs[middle] as Run).start <= offset) low = middle;
    else high = middle - 1;
  }
  const run = runs[low] as Run;
  const within = offset - run.start;
  if (within < 0) return { node: run.node, offset: 0 };
  if (within <= run.node.data.length) return { node: run.node, offset: within };
  // A line break between two blocks belongs to no node: the place is where the next run begins.
  const next = runs[low + 1];
  return next === undefined
    ? { node: run.node, offset: run.node.data.length }
    : { node: next.node, offset: 0 };
}

/** A DOM range over `[start, end)` of the chapter's text, in the document its runs are of; null for a chapter with no words. */
export function rangeAt(chapter: ChapterText, start: number, end: number): Range | null {
  const from = positionAt(chapter, start);
  const to = positionAt(chapter, end);
  if (from === null || to === null) return null;
  const range = from.node.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/**
 * The offset of the chapter's text a DOM position is at: within a text node
 * of it, or before the first word at or after a position between nodes.
 */
export function offsetAt(chapter: ChapterText, node: Node, offset: number): number {
  if (node.nodeType === TEXT_NODE) {
    const run = chapter.runs.find((each) => each.node === node);
    if (run !== undefined) return run.start + Math.min(offset, run.node.data.length);
  }
  const probe = node.ownerDocument?.createRange();
  if (probe === undefined) return chapter.text.length;
  probe.setStart(node, Math.min(offset, childCount(node)));
  // The first run whose start is not before the position; past them all, the end of the text.
  const after = chapter.runs.find((run) => probe.comparePoint(run.node, 0) >= 0);
  return after?.start ?? chapter.text.length;
}

const childCount = (node: Node): number =>
  node.nodeType === TEXT_NODE ? (node as Text).data.length : node.childNodes.length;
