import { hashEnd, hashFeed, hashOf, hashStart, passageWords } from '../highlights/passage-words.ts';
import type { KindleHighlight, KindleHighlightKey } from './kindle-types.ts';

export { hashOf };

/**
 * A highlight's identity across syncs (#508): Amazon's annotation id when
 * there is one, else the book, the location and a hash of the words, read as
 * {@link passageWords} does.
 */
export function kindleHighlightKey(args: {
  readonly asin: string;
  readonly annotationId: string | null;
  readonly location: number | null;
  /** The passage, or a note's words when no passage is marked. */
  readonly words: string;
}): KindleHighlightKey {
  return kindleKeyOfWordsHash({ ...args, wordsHash: hashOf(passageWords(args.words)) });
}

/**
 * {@link kindleHighlightKey} from the hash of the words rather than the
 * words, which is all a removed highlight's tombstone keeps of them.
 */
export function kindleKeyOfWordsHash(args: {
  readonly asin: string;
  readonly annotationId: string | null;
  readonly location: number | null;
  readonly wordsHash: string;
}): KindleHighlightKey {
  if (args.annotationId !== null) return `amazon:${args.annotationId}` as KindleHighlightKey;
  const location = args.location === null ? '-' : String(args.location);
  return `quote:${args.asin}:${location}:${args.wordsHash}` as KindleHighlightKey;
}

/**
 * The identity of a note typed on a passage: the passage's key and a hash of
 * the note. The passage keeps its own key whatever is typed on it, so a note
 * typed later arrives on its own; an edited note is a new entry after the old.
 */
export function kindleNoteKey(passage: KindleHighlightKey, note: string): KindleHighlightKey {
  return `${passage}:note:${hashOf(passageWords(note))}` as KindleHighlightKey;
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
    const words = `${passageWords(quote)}\u0000${passageWords(note ?? '')}`;
    const before = seen.get(key);
    if (before !== undefined && before !== words) return key;
    seen.set(key, words);
  }
  return null;
}

/**
 * The key of a note typed on `passage` for every run of consecutive
 * `paragraphs` of a comment: a note typed in paragraphs stands in the comment
 * as one run of them, anywhere in it. No run is left out, however long the
 * comment is: one left out would make a sync add the note again. Equal to
 * {@link kindleNoteKey} of the run's paragraphs joined, each key hashed from
 * the one before it rather than from the start.
 */
export function kindleNoteKeysOfRuns(
  passage: KindleHighlightKey,
  paragraphs: readonly string[],
): KindleHighlightKey[] {
  const words = paragraphs.map(passageWords).filter((paragraph) => paragraph !== '');
  const keys: KindleHighlightKey[] = [];
  for (let first = 0; first < words.length; first += 1) {
    const state = hashStart();
    for (let last = first; last < words.length; last += 1) {
      hashFeed(state, last === first ? (words[last] as string) : ` ${words[last]}`);
      keys.push(`${passage}:note:${hashEnd(state)}` as KindleHighlightKey);
    }
  }
  return keys;
}

/**
 * What a recorded set holds for a Kindle highlight the person removed: not
 * the highlight's own key, which a note that was never removed from holds too,
 * but this, so the highlight and every note typed on it stay out.
 */
export function removedKindleKey(passage: KindleHighlightKey): string {
  return `removed:${passage}`;
}

const NOTE_PART = ':note:';

/** The passage an entry's key belongs to: a note typed on a passage is that passage's. */
function passageOfEntry(key: string): KindleHighlightKey {
  const at = key.indexOf(NOTE_PART);
  return (at < 0 ? key : key.slice(0, at)) as KindleHighlightKey;
}

/**
 * The highlights not yet recorded, each once, in the order the notebook gave
 * them — and none of a passage the person removed (`removedKindleKey`), nor a
 * note typed on one.
 */
export function newKindleHighlights(
  highlights: readonly KindleHighlight[],
  recorded: ReadonlySet<string>,
): KindleHighlight[] {
  const seen = new Set<string>(recorded);
  const fresh: KindleHighlight[] = [];
  for (const highlight of highlights) {
    if (seen.has(highlight.key) || recorded.has(removedKindleKey(passageOfEntry(highlight.key)))) {
      continue;
    }
    seen.add(highlight.key);
    fresh.push(highlight);
  }
  return fresh;
}
