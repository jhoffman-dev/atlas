import {
  EMPTY_PAGE_TEXT,
  inReadingOrder,
  placeByBoxes,
  placeByWords,
  placeOnItsPage,
  type HighlightBlock,
  type HighlightPlacement,
  type PdfAnchor,
  textOffsetNear,
  type PdfPageText,
} from '@dfai/domain';
import type { PdfDocument } from './ports.ts';

/*
 * Drawing a literature note's highlights on its open PDF (#504, ADR-0043
 * §9). Each is looked for by its words on the page it names, which is one
 * page's text to read; only when some are not there is every page read, to
 * look outward. What is still not found is drawn at its saved boxes, or
 * listed as not found. A page that cannot be read costs the highlights
 * on it their words — each is drawn at its saved boxes there, never taken
 * for a copy of its words elsewhere — and never the other pages' theirs.
 */

/** A PDF highlight of the note, and where it is drawn. */
export interface PlacedHighlight {
  readonly block: HighlightBlock & { readonly anchor: PdfAnchor };
  readonly placement: HighlightPlacement;
  /** Where in its page's text it begins, which orders the panel as the page is read. */
  readonly offset: number;
}

type PdfBlock = PlacedHighlight['block'];
type TextSource = Pick<PdfDocument, 'pageCount' | 'pageText'>;

/** How many pages' text are asked of pdf.js at once: a long book is read in turns, not all together. */
const PAGES_AT_ONCE = 8;

/** The note's PDF highlights placed on `opened`, in reading order. */
export async function placeHighlights({
  opened,
  blocks,
}: {
  opened: TextSource;
  blocks: readonly HighlightBlock[];
}): Promise<PlacedHighlight[]> {
  const pdfBlocks = blocks.filter((block): block is PdfBlock => block.anchor.kind === 'pdf');
  const onOwnPage = await Promise.all(
    pdfBlocks.map((block) => placeOnOwnPage(opened, block.anchor)),
  );
  const missed = pdfBlocks.filter(
    (block, at) => onOwnPage[at] === null && block.anchor.quote !== null,
  );
  const everyPage = missed.length === 0 ? [] : await allPageTexts(opened);
  const placed = await Promise.all(
    pdfBlocks.map(async (block, at) => {
      const placement =
        onOwnPage[at] ??
        placeByWords(block.anchor, everyPage) ??
        placeByBoxes(block.anchor, opened.pageCount);
      return { block, placement, offset: await offsetOf(opened, placement) };
    }),
  );
  return inReadingOrder(placed);
}

async function placeOnOwnPage(
  opened: TextSource,
  anchor: PdfAnchor,
): Promise<HighlightPlacement | null> {
  if (anchor.quote === null || anchor.page > opened.pageCount) return null;
  const text = await pageTextOrUnknown(opened, anchor.page);
  return placeOnItsPage(anchor, { count: opened.pageCount, text });
}

/** Where a placement begins in its page's text: known for words, else the words nearest its box. */
async function offsetOf(opened: TextSource, placement: HighlightPlacement): Promise<number> {
  if (placement.kind === 'words') return placement.at;
  const box = placement.kind === 'lost' ? undefined : placement.rects[0];
  if (placement.kind === 'lost' || box === undefined) return 0;
  return textOffsetNear(await pageTextOrEmpty(opened, placement.page), box);
}

/** Page `page`'s text, or a page with none when pdf.js cannot read it. */
async function pageTextOrEmpty(opened: TextSource, page: number): Promise<PdfPageText> {
  return (await pageTextOrUnknown(opened, page)) ?? EMPTY_PAGE_TEXT;
}

/** Page `page`'s text, or null when pdf.js cannot read it: its words are unknown, not absent. */
async function pageTextOrUnknown(opened: TextSource, page: number): Promise<PdfPageText | null> {
  try {
    return await opened.pageText(page);
  } catch {
    // One damaged page is a page whose words are unknown, not a document without highlights.
    return null;
  }
}

/** Every page's text, in order, asked for a few pages at a time; an unreadable page is one without words. */
export async function allPageTexts(opened: TextSource): Promise<PdfPageText[]> {
  const texts: PdfPageText[] = [];
  for (let first = 1; first <= opened.pageCount; first += PAGES_AT_ONCE) {
    const last = Math.min(first + PAGES_AT_ONCE - 1, opened.pageCount);
    const turn = Array.from({ length: last - first + 1 }, (_, at) =>
      pageTextOrEmpty(opened, first + at),
    );
    texts.push(...(await Promise.all(turn)));
  }
  return texts;
}
