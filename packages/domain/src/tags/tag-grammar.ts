import {
  continuesTagSegment,
  EDGE_UNDERSCORE,
  endsInOneLetterWord,
  hasTagLetter,
  isTagName,
  startsTagSegment,
} from './tag-name.ts';
import { shieldedSpans } from './tag-shields.ts';

/** A tag found in a run of text: where it is, `#`s included, and its name. */
export interface TagMatch {
  readonly start: number;
  readonly end: number;
  /** As written, without the `#`s. */
  readonly name: string;
  /** Written Bear's way, with a closing `#`: `#tag me#`. */
  readonly closed: boolean;
}

/**
 * What may sit right before a tag's `#`: nothing, a space or line break, or an
 * opening bracket. Anything else makes the `#` part of something else — a word
 * (`C#`, `issue#12`), a URL fragment, an escape (`\#`), an entity (`&#35;`).
 */
const OPENS_TAG = /^[\s(]$/u;

/**
 * Every tag in a run of text, in order.
 *
 * `#` followed directly by a word is a tag — `# ` is a heading. A tag may
 * nest with `/` (`#para/resource`), and may hold several words when it is
 * closed by a `#` later on the same line (`#tag me#`, as Bear writes it). A
 * closing `#` follows a word, not a space, and is not itself followed by one,
 * so `#one and #two` is two tags.
 *
 * The text is one run, as the markdown parser hands it over: code, links and
 * other markup are separate runs, and are shielded here too in case they are not.
 */
export function findTags(text: string): TagMatch[] {
  const shields = shieldedSpans(text);
  const found: TagMatch[] = [];
  let shield = 0;
  let at = text.indexOf('#');
  while (at !== -1) {
    // Spans are in order and apart, and `at` only grows: one pass over both.
    while (shield < shields.length && (shields[shield] as { end: number }).end <= at) shield += 1;
    const inShield = shield < shields.length && (shields[shield] as { start: number }).start <= at;
    const tag = inShield ? null : tagAt(text, at);
    if (tag !== null) found.push(tag);
    at = text.indexOf('#', tag === null ? at + 1 : tag.end);
  }
  return found;
}

function tagAt(text: string, at: number): TagMatch | null {
  const before = text[at - 1];
  if (before !== undefined && !OPENS_TAG.test(before)) return null;
  return closedTagAt(text, at) ?? openTagAt(text, at);
}

/** The code point starting at `index`, whole even when it takes two code units. */
function charAt(text: string, index: number): string | undefined {
  const point = text.codePointAt(index);
  return point === undefined ? undefined : String.fromCodePoint(point);
}

/**
 * `#word`, `#a/b/c`: parts of word characters joined by single slashes. A
 * part's closing `_`s are left out, and the tag ends there.
 */
function openTagAt(text: string, at: number): TagMatch | null {
  let end = at + 1;
  /** Reads one part; false when it ended on `_`s, which also ends the tag. */
  const segment = () => {
    let last = end;
    for (let char = charAt(text, end); continuesTagSegment(char); char = charAt(text, end)) {
      end += (char as string).length;
      if (char !== EDGE_UNDERSCORE) last = end;
    }
    const whole = end === last;
    end = last;
    return whole;
  };
  if (!startsTagSegment(charAt(text, end))) return null;
  let whole = segment();
  while (whole && text[end] === '/' && startsTagSegment(charAt(text, end + 1))) {
    end += 1;
    whole = segment();
  }
  const name = text.slice(at + 1, end);
  return hasTagLetter(name) ? { start: at, end, name, closed: false } : null;
}

/**
 * `#tag me#`: a name of words and slashes, closed by the next `#` on the line
 * — unless its last word is a single letter, whose `#` is `C#` or `F#` rather
 * than a closing one (`#todo fix the F# build` is the tag `todo`).
 */
function closedTagAt(text: string, at: number): TagMatch | null {
  let end = at + 1;
  for (let char = charAt(text, end); char !== '#'; char = charAt(text, end)) {
    if (char === undefined || !(char === ' ' || char === '/' || continuesTagSegment(char))) {
      return null;
    }
    end += char.length;
  }
  const name = text.slice(at + 1, end);
  const after = charAt(text, end + 1);
  if (!isTagName(name) || after === '#' || continuesTagSegment(after)) return null;
  if (endsInOneLetterWord(name)) return null;
  return { start: at, end: end + 1, name, closed: true };
}
