import type { TextSelection } from '@dfai/domain';

/*
 * Reading the window's selection back as offsets into a page's text (#504).
 * Each run of the text layer carries where its words start in the page's
 * text (`data-start`), and each page its number and its text's length, so a
 * selection is a page and two offsets. A selection that runs on past its
 * first page is cut at that page's end: one highlight is on one page.
 */

const PAGE = '[data-pdf-page]';
const RUN = '[data-start]';

/** The page and offsets `selection` covers, or null when it covers no page's words. */
export function selectionInPage(selection: Selection | null): TextSelection | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const startPage = pageOf(range.startContainer);
  if (startPage === null) return null;
  const page = Number(startPage.dataset['pdfPage']);
  const start = offsetAt(startPage, range.startContainer, range.startOffset);
  const end =
    pageOf(range.endContainer) === startPage
      ? offsetAt(startPage, range.endContainer, range.endOffset)
      : Number(startPage.dataset['textLength'] ?? 0);
  if (start === null || end === null || !Number.isFinite(page) || end <= start) return null;
  return { page, start, end };
}

function pageOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(PAGE) ?? null;
}

/** Where a point of a range is in the page's text: inside a run, or between runs. */
function offsetAt(page: HTMLElement, node: Node, offset: number): number | null {
  const run = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(RUN);
  if (run !== null && run !== undefined && page.contains(run)) {
    const start = Number(run.dataset['start']);
    return node.nodeType === Node.TEXT_NODE ? start + offset : start;
  }
  // Between runs: the point is a child index of an element, the text layer or the page.
  const runs = [...page.querySelectorAll<HTMLElement>(RUN)];
  if (runs.length === 0) return null;
  const after = node instanceof Element ? node.childNodes[offset] : null;
  const next = runs.find(
    (candidate) =>
      after !== null &&
      after !== undefined &&
      (candidate === after ||
        Boolean(after.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)),
  );
  return next === undefined
    ? Number(runs.at(-1)?.dataset['end'] ?? 0)
    : Number(next.dataset['start']);
}
