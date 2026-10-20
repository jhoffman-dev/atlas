/** The box of the link a card is for, in viewport pixels. */
export interface AnchorRect {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

/** Where the card goes: under the link, or over it when there is no room below. */
export type PreviewPlacement =
  | { readonly left: number; readonly top: number }
  | { readonly left: number; readonly bottom: number };

/** The card's width (FlowPeek.dc.html). */
export const PREVIEW_CARD_WIDTH = 360;
/** Room kept for the card under a link: its head, four lines and its foot. */
const CARD_ROOM = 180;
const GAP = 6;
const EDGE = 8;

/**
 * Places the preview card by its link: left edges aligned and the card kept
 * inside the window, below the link unless that would run off the bottom,
 * then above it.
 */
export function previewPlacement(
  anchor: AnchorRect,
  viewport: { readonly width: number; readonly height: number },
): PreviewPlacement {
  const widest = Math.max(EDGE, viewport.width - PREVIEW_CARD_WIDTH - EDGE);
  const left = Math.min(Math.max(anchor.left, EDGE), widest);
  if (anchor.bottom + GAP + CARD_ROOM <= viewport.height) {
    return { left, top: anchor.bottom + GAP };
  }
  return { left, bottom: viewport.height - anchor.top + GAP };
}
