/*
 * Words as a highlight's identity reads them (ADR-0043 §7, ADR-0044): the
 * same passage, written with an invisible character or a decomposed accent
 * one day and not the next, is one passage, and a hash of the words says so
 * without keeping them.
 */

/**
 * Characters that show nothing, which a page may carry in a passage and a
 * later page not: the soft hyphen, zero-width spaces and joiners, the word
 * joiner, the byte-order mark, and the direction marks, embeddings and
 * isolates (U+200E-F, U+202A-E, U+2066-9).
 */
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/** `words` without the characters that show nothing ({@link INVISIBLE}). */
export const withoutInvisibles = (words: string): string => words.replace(INVISIBLE, '');

/**
 * Words as a key reads them: without invisible characters, then composed
 * (NFC), white space collapsed. So a passage the notebook writes with a
 * combining accent one day and a composed one the next is the same one. The
 * invisibles go first: one between a letter and its accent keeps them from
 * composing.
 */
export function passageWords(words: string): string {
  return withoutInvisibles(words).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic and
 * need not be — it tells one highlight's words from another's in one book at
 * one location, where nothing is trying to collide.
 */
export function hashOf(text: string): string {
  const state = hashStart();
  hashFeed(state, text);
  return hashEnd(state);
}

/** cyrb53 taken in pieces, so the hashes of a text and of its longer forms share their work. */
export interface HashState {
  h1: number;
  h2: number;
}

export const hashStart = (): HashState => ({ h1: 0xdeadbeef, h2: 0x41c6ce57 });

export function hashFeed(state: HashState, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    state.h1 = Math.imul(state.h1 ^ code, 2654435761);
    state.h2 = Math.imul(state.h2 ^ code, 1597334677);
  }
}

/** The hash of what was fed so far; the state can be fed more afterwards. */
export function hashEnd({ h1: first, h2: second }: HashState): string {
  let h1 = first;
  let h2 = second;
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}
