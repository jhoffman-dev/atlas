/**
 * Obsidian callouts: a blockquote whose first line is `[!note]`, optionally with
 * a title and a fold marker.
 *
 *     > [!warning] Be careful
 *     > body text
 */
export interface CalloutMarker {
  readonly kind: string;
  readonly title: string | null;
  /** `+` or `-` when the callout is foldable; kept so it round-trips. */
  readonly fold: string | null;
}

const MARKER = /^\[!([A-Za-z][\w-]*)\]([+-])?[ \t]*(.*)$/;

export function parseCalloutMarker(line: string): CalloutMarker | null {
  const match = MARKER.exec(line);
  if (match === null) return null;
  const title = (match[3] ?? '').trim();
  return {
    kind: (match[1] ?? '').toLowerCase(),
    title: title === '' ? null : title,
    fold: match[2] ?? null,
  };
}

export function formatCalloutMarker(marker: CalloutMarker): string {
  const fold = marker.fold ?? '';
  const title = marker.title === null ? '' : ` ${marker.title}`;
  return `[!${marker.kind}]${fold}${title}`;
}

/** The label shown when a callout has no title of its own. */
export function calloutLabel(marker: CalloutMarker): string {
  if (marker.title !== null) return marker.title;
  return marker.kind.charAt(0).toUpperCase() + marker.kind.slice(1);
}
