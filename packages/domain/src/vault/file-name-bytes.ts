/** The most bytes a file name may have on macOS (APFS and HFS+ alike). */
export const MAX_NAME_BYTES = 255;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** How many bytes a name takes on disk, which is UTF-8. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * `stem`, cut by whole characters as a reader sees them — never half an emoji
 * — until `stem` followed by `ending` (an extension, a number) fits in
 * {@link MAX_NAME_BYTES}. Unchanged when it already fits.
 */
export function fitFileNameStem(stem: string, ending: string): string {
  const room = MAX_NAME_BYTES - utf8Bytes(ending);
  if (utf8Bytes(stem) <= room) return stem;
  let kept = '';
  for (const { segment } of graphemes.segment(stem)) {
    if (utf8Bytes(kept + segment) > room) break;
    kept += segment;
  }
  return kept.trimEnd();
}
