/**
 * Opening a link outside the app, in the person's own browser — an
 * artifact's claude.ai page. The webview itself never navigates away.
 */
export interface ExternalLinkPort {
  /** Rejects when the host will not open it: anything but an http or https link. */
  open(url: string): Promise<void>;
}

/** A page to picture, and how: the numbers are `THUMBNAIL_SHOT`'s. */
export interface PageSnapshotRequest {
  /** The whole page, its files written into it, its policy first (`inlineArtifactPage`). */
  readonly html: string;
  /** The screen it is laid out on, in points. */
  readonly width: number;
  readonly height: number;
  /** The picture's width in pixels; its height keeps the screen's shape. */
  readonly pictureWidth: number;
  /** How long after it has loaded before it is pictured. */
  readonly settleMs: number;
  /** How long all of it may take. */
  readonly timeoutMs: number;
}

/**
 * Picturing a page's first screen, somewhere that is not the app: the host
 * loads it in a webview of its own with no way back to the app, and throws
 * that away after. Rejects when it cannot — another platform, a page that
 * never loads.
 */
export interface PageSnapshotPort {
  /** The picture, as the bytes of a PNG — unchecked: see `thumbnailRefusal`. */
  capture(request: PageSnapshotRequest): Promise<Uint8Array>;
}
