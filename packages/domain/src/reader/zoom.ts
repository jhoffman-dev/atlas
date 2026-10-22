/*
 * The reader's zoom (#504): a ladder of steps, as a book reader offers, and
 * a fit to the pane's width. A zoom is the page's width on screen over its
 * width in points (CSS pixels at 100%).
 */

export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const SMALLEST_ZOOM = ZOOM_STEPS[0];
export const LARGEST_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] as number;

/** `zoom` within what the reader draws; a zoom that is not a number is 100%. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(Math.max(zoom, SMALLEST_ZOOM), LARGEST_ZOOM);
}

/** The next step up from `zoom`, or the largest. */
export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 1e-9) ?? LARGEST_ZOOM;
}

/** The next step down from `zoom`, or the smallest. */
export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-9) ?? SMALLEST_ZOOM;
}

/** The zoom that makes a page `pageWidth` points wide fill `available` pixels, less a margin either side. */
export function fitWidthZoom({
  available,
  pageWidth,
  margin = 24,
}: {
  available: number;
  pageWidth: number;
  margin?: number;
}): number {
  if (!(pageWidth > 0) || !(available > 0)) return 1;
  return clampZoom((available - margin * 2) / pageWidth);
}

/** The zoom as the toolbar says it: a whole percentage. */
export const zoomLabel = (zoom: number): string => `${Math.round(clampZoom(zoom) * 100)}%`;
