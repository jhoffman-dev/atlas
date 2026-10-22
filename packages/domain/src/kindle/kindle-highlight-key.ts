import type { KindleHighlight, KindleHighlightKey } from './kindle-types.ts';

/**
 * A highlight's identity across syncs (#508): Amazon's annotation id when
 * there is one, else the book, the location and a hash of the words. The
 * words are hashed with their white space collapsed, so a page that wraps
 * the same passage differently is still the same highlight.
 */
export function kindleHighlightKey(args: {
  readonly asin: string;
  readonly annotationId: string | null;
  readonly location: number | null;
  /** The passage, or a note's words when no passage is marked. */
  readonly words: string;
}): KindleHighlightKey {
  if (args.annotationId !== null) return `amazon:${args.annotationId}` as KindleHighlightKey;
  const words = args.words.replace(/\s+/g, ' ').trim();
  const location = args.location === null ? '-' : String(args.location);
  return `quote:${args.asin}:${location}:${hashOf(words)}` as KindleHighlightKey;
}

/**
 * cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic and
 * need not be — it tells one highlight's words from another's in one book at
 * one location, where nothing is trying to collide.
 */
export function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

/** The highlights not yet recorded, each once, in the order the notebook gave them. */
export function newKindleHighlights(
  highlights: readonly KindleHighlight[],
  recorded: ReadonlySet<string>,
): KindleHighlight[] {
  const seen = new Set<string>(recorded);
  const fresh: KindleHighlight[] = [];
  for (const highlight of highlights) {
    if (seen.has(highlight.key)) continue;
    seen.add(highlight.key);
    fresh.push(highlight);
  }
  return fresh;
}
