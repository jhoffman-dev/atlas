import { EPUB_FRAME_POLICY, type HighlightColor, type HighlightStyle } from '@dfai/domain';
import { chapterText, offsetAt, rangeAt, type ChapterText } from './chapter-text.ts';
import { LINK_FRAGMENT, LINK_PATH } from './chapter-safety.ts';

/*
 * A chapter shown in a frame of its own (#505). The frame is made from a
 * document DFAI writes — the policy that loads nothing from outside the book
 * and runs no script, first in its head — and the chapter, already made
 * safe (`makeChapterSafe`) and its files given addresses, is then put in as
 * its root, node for node, so a place in it is the same CFI as in the book.
 * Highlights and find's matches are drawn with the CSS Custom Highlight API,
 * which marks text without adding a node; the reader's own styles are
 * adopted, not written into the chapter, for the same reason.
 *
 * The frame is sandboxed with `allow-same-origin`, so the reader can read
 * the selection and draw in it, and `allow-scripts`, because WebKit
 * delivers no event to a listener in a frame without it (WebKit bug
 * 218086): no script of the book can run all the same — the chapter holds
 * none, and the frame's policy says `script-src 'none'`. No forms, no
 * pop-ups, no navigation of the window.
 */

const FRAME_SANDBOX = 'allow-same-origin allow-scripts';

/** The frame's window, with its own constructors: a highlight or a stylesheet is made in the frame's realm. */
type FrameWindow = Window & typeof globalThis;

/** How the book looks: the reader's colours, read from its own theme. */
export interface ChapterAppearance {
  /** The text's size, as a percentage of the book's own. */
  readonly fontSize: number;
  /** Dark: the book's own colours give way to the window's, so it reads on a dark page. */
  readonly scheme: 'light' | 'dark';
  readonly ink: string;
  readonly page: string;
  readonly link: string;
  /** Each highlight colour's fill, and the line an underline is drawn with. */
  readonly marks: Readonly<
    Record<HighlightColor, { readonly fill: string; readonly line: string }>
  >;
  /** The ink on a highlight's fill, which is pale in every theme. */
  readonly markInk: string;
  readonly flash: string;
  readonly found: string;
  readonly foundCurrent: string;
}

/** A highlight drawn in the chapter: `[start, end)` of its text, and its style. */
export interface ChapterMark {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly style: HighlightStyle;
}

/** What the person does in the frame that the reader acts on. */
export interface ChapterEvents {
  /** A link inside the book was followed: the book's file it leads to, and the place in it. */
  onLink(target: { path: string; fragment: string | null }): void;
  /** A press or a key let go: the selection may have changed. */
  onSelectionEnd(): void;
  /** A key pressed in the frame, which the reader's own shortcuts (⌘F) may want. */
  onKeyDown(event: KeyboardEvent): void;
  onScroll(): void;
}

/** A chapter on screen, for the reader to draw in, read the selection of, and scroll. */
export interface ShownChapter {
  /** The words selected in the chapter, as offsets of its text, and where they are on screen; null when none. */
  selection(): { start: number; end: number; rect: DOMRect } | null;
  clearSelection(): void;
  /** Draws these highlights, `flashing` lit for a moment; the ones drawn before are taken away. */
  paint(marks: readonly ChapterMark[], flashing: string | null): void;
  /** Draws find's matches, the current one apart. */
  paintFound(found: readonly { start: number; end: number }[], current: number | null): void;
  /** Brings offset `offset` of the chapter's text into view. */
  scrollToOffset(offset: number): void;
  /** Brings the element `#fragment` names into view, or the top when there is none. */
  scrollToFragment(fragment: string | null): void;
  setAppearance(appearance: ChapterAppearance): void;
  /** Takes the frame away. */
  destroy(): void;
}

/** Shows `chapter` (made safe, its files given addresses) in a new frame inside `host`. */
export async function showChapter({
  host,
  chapter,
  appearance,
  events,
}: {
  host: HTMLElement;
  chapter: Document;
  appearance: ChapterAppearance;
  events: ChapterEvents;
}): Promise<ShownChapter> {
  const frame = host.ownerDocument.createElement('iframe');
  frame.className = 'epub-frame';
  frame.title = 'Book text';
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = FRAME_SHELL;
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  );
  host.append(frame);
  await loaded;
  const doc = frame.contentDocument;
  const view = frame.contentWindow as FrameWindow | null;
  if (doc === null || view === null)
    throw new Error('The book could not be shown: its frame did not open.');
  doc.replaceChild(doc.importNode(chapter.documentElement, true), doc.documentElement);
  const text = chapterText(doc);
  const sheet = new view.CSSStyleSheet();
  doc.adoptedStyleSheets = [sheet];
  const detach = listen(doc, view, events);
  const shown = shownChapter({ frame, doc, view, text, sheet, detach });
  shown.setAppearance(appearance);
  return shown;
}

/** The document the frame starts as: the policy first, before anything of the book is in it. */
const FRAME_SHELL = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${EPUB_FRAME_POLICY}"></head><body></body></html>`;

function listen(doc: Document, view: FrameWindow, events: ChapterEvents): () => void {
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.('a, area');
    if (link === null || link === undefined) return;
    // Nothing in a book navigates the frame: a link of the book is the reader's to follow.
    event.preventDefault();
    const path = link.getAttribute(LINK_PATH);
    if (path !== null) events.onLink({ path, fragment: link.getAttribute(LINK_FRAGMENT) });
  };
  const onSubmit = (event: Event) => event.preventDefault();
  const onUp = () => events.onSelectionEnd();
  const onKey = (event: KeyboardEvent) => events.onKeyDown(event);
  const onScroll = () => events.onScroll();
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('mouseup', onUp);
  doc.addEventListener('keyup', onUp);
  doc.addEventListener('keydown', onKey);
  view.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('mouseup', onUp);
    doc.removeEventListener('keyup', onUp);
    doc.removeEventListener('keydown', onKey);
    view.removeEventListener('scroll', onScroll);
  };
}

/** The highlights the frame's registry holds under DFAI's names, so a repaint takes away only its own. */
const MARK_PREFIX = 'dfai-';

function shownChapter({
  frame,
  doc,
  view,
  text,
  sheet,
  detach,
}: {
  frame: HTMLIFrameElement;
  doc: Document;
  view: FrameWindow;
  text: ChapterText;
  sheet: CSSStyleSheet;
  detach: () => void;
}): ShownChapter {
  const registry = highlightRegistry(view);
  const rangeOf = (start: number, end: number) => rangeAt(text, start, end);
  const draw = (prefix: string, groups: ReadonlyMap<string, Range[]>) => {
    if (registry === null) return;
    for (const name of [...registry.keys()]) {
      if (name.startsWith(prefix) && !groups.has(name)) registry.delete(name);
    }
    for (const [name, ranges] of groups) {
      const highlight = new view.Highlight(...ranges);
      // Lit and current marks are drawn over the highlights they fall on.
      if (name.endsWith('flash') || name.endsWith('-current')) highlight.priority = 1;
      registry.set(name, highlight);
    }
  };
  return {
    selection() {
      const selected = view.getSelection();
      if (selected === null || selected.rangeCount === 0 || selected.isCollapsed) return null;
      const range = selected.getRangeAt(0);
      const start = offsetAt(text, range.startContainer, range.startOffset);
      const end = offsetAt(text, range.endContainer, range.endOffset);
      if (start === end) return null;
      const box = range.getBoundingClientRect();
      const at = frame.getBoundingClientRect();
      return {
        start,
        end,
        rect: new DOMRect(at.left + box.left, at.top + box.top, box.width, box.height),
      };
    },
    clearSelection: () => view.getSelection()?.removeAllRanges(),
    paint(marks, flashing) {
      const groups = new Map<string, Range[]>();
      for (const mark of marks) {
        const range = rangeOf(mark.start, mark.end);
        if (range === null) continue;
        groupInto(groups, `${MARK_PREFIX}${mark.style.mark}-${mark.style.color}`, range);
        if (mark.id === flashing) groupInto(groups, `${MARK_PREFIX}flash`, range);
      }
      draw(`${MARK_PREFIX}highlight-`, groups);
      draw(`${MARK_PREFIX}underline-`, groups);
      draw(`${MARK_PREFIX}flash`, groups);
    },
    paintFound(found, current) {
      const groups = new Map<string, Range[]>();
      for (const [at, match] of found.entries()) {
        const range = rangeOf(match.start, match.end);
        if (range !== null)
          groupInto(groups, `${MARK_PREFIX}found${at === current ? '-current' : ''}`, range);
      }
      draw(`${MARK_PREFIX}found`, groups);
    },
    scrollToOffset(offset) {
      const range = rangeOf(offset, offset);
      const box = range?.getBoundingClientRect();
      if (box === undefined) return;
      view.scrollTo({ top: Math.max(0, view.scrollY + box.top - 80) });
    },
    scrollToFragment(fragment) {
      const target =
        fragment === null
          ? null
          : (doc.getElementById(fragment) ??
            doc.querySelector(`[name="${view.CSS.escape(fragment)}"]`));
      if (target === null) view.scrollTo({ top: 0 });
      else target.scrollIntoView({ block: 'start' });
    },
    setAppearance(appearance) {
      sheet.replaceSync(readerCss(appearance));
    },
    destroy() {
      detach();
      frame.remove();
    },
  };
}

function groupInto(groups: Map<string, Range[]>, name: string, range: Range): void {
  const group = groups.get(name);
  if (group === undefined) groups.set(name, [range]);
  else group.push(range);
}

/** The frame's highlight registry, or null in a browser without the CSS Custom Highlight API. */
function highlightRegistry(view: FrameWindow): HighlightRegistry | null {
  return typeof view.CSS?.highlights === 'object' && typeof view.Highlight === 'function'
    ? view.CSS.highlights
    : null;
}

/** The reader's styles inside the frame: the size the person chose, the theme's colours, and how marks are drawn. */
function readerCss(look: ChapterAppearance): string {
  const marks = Object.entries(look.marks).flatMap(([color, { fill, line }]) => [
    `::highlight(${MARK_PREFIX}highlight-${color}) { background-color: ${fill}; color: ${look.markInk}; }`,
    `::highlight(${MARK_PREFIX}underline-${color}) { text-decoration: underline 2px ${line}; text-decoration-color: ${line}; }`,
  ]);
  const dark =
    look.scheme === 'dark'
      ? [
          `body, body * { color: ${look.ink} !important; background-color: transparent !important; border-color: currentColor; }`,
          `a, a * { color: ${look.link} !important; }`,
        ]
      : [];
  return [
    `:root { color-scheme: ${look.scheme}; font-size: ${look.fontSize}%; background: ${look.page}; }`,
    `body { margin: 0 auto; padding: 32px 40px 96px; max-width: 42em; line-height: 1.6; color: ${look.ink}; overflow-wrap: break-word; }`,
    'img, svg, video { max-width: 100%; height: auto; }',
    ...dark,
    ...marks,
    `::highlight(${MARK_PREFIX}found) { background-color: ${look.found}; color: ${look.markInk}; }`,
    `::highlight(${MARK_PREFIX}found-current) { background-color: ${look.foundCurrent}; color: ${look.markInk}; }`,
    `::highlight(${MARK_PREFIX}flash) { background-color: ${look.flash}; color: ${look.markInk}; }`,
  ].join('\n');
}
