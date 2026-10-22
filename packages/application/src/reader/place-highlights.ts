import {
  inReadingOrder,
  placeByBoxes,
  placeByWords,
  placeOnItsPage,
  type HighlightBlock,
  type HighlightPlacement,
  type PdfAnchor,
  type PdfPageText,
} from '@dfai/domain';
import type { PdfDocument } from './ports.ts';

/*
 * Drawing a literature note's highlights on its open PDF (#504, ADR-0043
 * §9). Each is looked for by its words on the page it names, which is one
 * page's text to read; only when some are not there is every page read, to
 * look outward. What is still not found is drawn at its saved boxes, or
 * listed as not found.
 */

/** A PDF highlight of the note, and where it is drawn. */
export interface PlacedHighlight {
  readonly block: HighlightBlock & { readonly anchor: PdfAnchor };
  readonly placement: HighlightPlacement;
}

type PdfBlock = PlacedHighlight['block'];

/** The note's PDF highlights placed on `document`, in reading order. */
export async function placeHighlights({
  document,
  blocks,
}: {
  document: Pick<PdfDocument, 'pageCount' | 'pageText'>;
  blocks: readonly HighlightBlock[];
}): Promise<PlacedHighlight[]> {
  const pdfBlocks = blocks.filter((block): block is PdfBlock => block.anchor.kind === 'pdf');
  const onOwnPage = await Promise.all(
    pdfBlocks.map((block) => placeOnOwnPage(document, block.anchor)),
  );
  const missed = pdfBlocks.filter(
    (block, at) => onOwnPage[at] === null && block.anchor.quote !== null,
  );
  const everyPage = missed.length === 0 ? [] : await allPageTexts(document);
  const placed = pdfBlocks.map((block, at) => ({
    block,
    placement:
      onOwnPage[at] ??
      placeByWords(block.anchor, everyPage) ??
      placeByBoxes(block.anchor, document.pageCount),
  }));
  return inReadingOrder(placed);
}

async function placeOnOwnPage(
  document: Pick<PdfDocument, 'pageCount' | 'pageText'>,
  anchor: PdfAnchor,
): Promise<HighlightPlacement | null> {
  if (anchor.quote === null || anchor.page > document.pageCount) return null;
  const text = await document.pageText(anchor.page);
  return placeOnItsPage(anchor, { count: document.pageCount, text });
}

/** Every page's text, in order. */
export function allPageTexts(
  document: Pick<PdfDocument, 'pageCount' | 'pageText'>,
): Promise<PdfPageText[]> {
  return Promise.all(
    Array.from({ length: document.pageCount }, (_, at) => document.pageText(at + 1)),
  );
}
