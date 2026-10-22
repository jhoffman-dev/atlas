import type { KindleHighlight, KindleHighlightKey } from './kindle-types.ts';

/**
 * Characters that show nothing, which a page may carry in a passage and a
 * later page not: the soft hyphen, zero-width spaces and joiners, the word
 * joiner, the byte-order mark, and the direction marks, embeddings and
 * isolates (U+200E-F, U+202A-E, U+2066-9).
 */
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/**
 * Words as a key reads them: without invisible characters, then composed
 * (NFC), white space collapsed. So a passage the notebook writes with a
 * combining accent one day and a composed one the next is the same one. The
 * invisibles go first: one between a letter and its accent keeps them from
 * composing.
 */
function keyWords(words: string): string {
  return words.replace(INVISIBLE, '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * A highlight's identity across syncs (#508): Amazon's annotation id when
 * there is one, else the book, the location and a hash of the words, read as
 * {@link keyWords} does.
 */
export function kindleHighlightKey(args: {
  readonly asin: string;
  readonly annotationId: string | null;
  readonly location: number | null;
  /** The passage, or a note's words when no passage is marked. */
  readonly words: string;
}): KindleHighlightKey {
  if (args.annotationId !== null) return `amazon:${args.annotationId}` as KindleHighlightKey;
  const location = args.location === null ? '-' : String(args.location);
  return `quote:${args.asin}:${location}:${hashOf(keyWords(args.words))}` as KindleHighlightKey;
}

/**
 * The identity of a note typed on a passage: the passage's key and a hash of
 * the note. The passage keeps its own key whatever is typed on it, so a note
 * typed later arrives on its own; an edited note is a new entry after the old.
 */
export function kindleNoteKey(passage: KindleHighlightKey, note: string): KindleHighlightKey {
  return `${passage}:note:${hashOf(keyWords(note))}` as KindleHighlightKey;
}

/**
 * A key that two entries share while holding different words: two passages,
 * or two notes, that claim one annotation id. Either the page is not what
 * this reads, or one of them would be lost behind the other. Null when none.
 */
export function findKindleKeyClash(
  highlights: readonly KindleHighlight[],
): KindleHighlightKey | null {
  const seen = new Map<string, string>();
  for (const { key, quote, note } of highlights) {
    const words = `${keyWords(quote)}\u0000${keyWords(note ?? '')}`;
    const before = seen.get(key);
    if (before !== undefined && before !== words) return key;
    seen.set(key, words);
  }
  return null;
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
