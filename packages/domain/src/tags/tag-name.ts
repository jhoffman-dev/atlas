/**
 * A tag's name is what follows its `#`: `idea`, `para/resource`, `tag me`.
 * Each `/` nests it under the part before, and each part is a word — or,
 * written Bear's way between two `#`s, several words.
 */

const SEGMENT_START = /^[\p{L}\p{N}]$/u;
const SEGMENT_CHAR = /^[\p{L}\p{N}\p{M}_-]$/u;
const LETTER = /\p{L}/u;

/**
 * `_` may be inside a word of a tag's name (`#my_tag`) but may not open or
 * end one: markdown reads `_x_` as emphasis, so `#_draft_` could not survive
 * a save. A word's closing `_`s are simply not part of the tag.
 */
export const EDGE_UNDERSCORE = '_';

/** Whether `char` may open one part of a tag's name. */
export function startsTagSegment(char: string | undefined): boolean {
  return char !== undefined && SEGMENT_START.test(char);
}

/** Whether `char` may carry on one part of a tag's name. */
export function continuesTagSegment(char: string | undefined): boolean {
  return char !== undefined && SEGMENT_CHAR.test(char);
}

/**
 * A number alone is not a tag — `#123` is an issue, `#2026` a year — so a
 * name holds at least one letter.
 */
export function hasTagLetter(name: string): boolean {
  return LETTER.test(name);
}

/**
 * Whether `name` can be written as a tag: parts separated by `/`, each made of
 * words joined by single spaces, each word what a tag's word may be, and a
 * letter somewhere in it.
 */
export function isTagName(name: string): boolean {
  if (!hasTagLetter(name)) return false;
  return name.split('/').every((part) => part.split(' ').every(isTagWord));
}

function isTagWord(word: string): boolean {
  const chars = [...word];
  return (
    startsTagSegment(chars[0]) &&
    chars.every(continuesTagSegment) &&
    chars.at(-1) !== EDGE_UNDERSCORE
  );
}

/**
 * Whether a name of several words ends in a one-letter word. Its closing `#`
 * would read as `C#` or `F#` does, so such a name cannot be written as a tag:
 * `#plan a#` is `#plan`.
 */
export function endsInOneLetterWord(name: string): boolean {
  const lastWord = name.slice(name.lastIndexOf(' ') + 1);
  return name.includes(' ') && [...lastWord].length === 1;
}

/**
 * What makes two tags the same tag: case is ignored, as are the ways one
 * letter can be encoded, and runs of spaces count as one. `#Idea` and `#idea`
 * are one tag, shown the way it was first written.
 */
export function tagKey(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/ +/g, ' ');
}

/**
 * A tag as it is written in a note. A name with a space needs Bear's closing
 * `#` to be read back whole; one without keeps whichever form it had.
 */
export function formatTag(name: string, closed = false): string {
  return closed || name.includes(' ') ? `#${name}#` : `#${name}`;
}

/** Whether `key` is `ancestor` or nested somewhere under it. Both are keys. */
export function isTagWithin(key: string, ancestor: string): boolean {
  return key === ancestor || key.startsWith(`${ancestor}/`);
}

/**
 * `name` after `from` is renamed to `to`, or null when it is neither `from`
 * nor nested under it. A nested tag keeps the rest of its name as it was
 * written: renaming `para` to `Area` makes `#Para/Resource` `#Area/Resource`.
 */
export function renamedTagName({
  name,
  from,
  to,
}: {
  name: string;
  from: string;
  to: string;
}): string | null {
  const fromKey = tagKey(from);
  if (!isTagWithin(tagKey(name), fromKey)) return null;
  const depth = fromKey.split('/').length;
  return [to, ...name.split('/').slice(depth)].join('/');
}

/** A tag's name as typed into a box: the `#`s it may be typed with are not part of it. */
export function tagNameFromInput(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('#') ? trimmed.slice(1).replace(/#$/, '').trim() : trimmed;
}

/**
 * Why `to` cannot be the new name of the tag `from`, or null when it can.
 * Its own name is allowed — every use is then written the way it is shown —
 * but a name nested under itself is not: the uses that already had that name
 * could not be told from the ones moved there.
 */
export function tagRenameProblem({ from, to }: { from: string; to: string }): string | null {
  if (to === '') return 'Give the tag a name.';
  const edged = to.split(/[/ ]/).some((word) => word.startsWith('_') || word.endsWith('_'));
  if (edged) return 'A tag’s name, and each part of it, may not start or end with _.';
  if (!isTagName(to)) {
    return 'A tag is words of letters, numbers, _ or -, with a letter in it and / between nested parts.';
  }
  if (endsInOneLetterWord(to)) {
    return `A tag of several words can’t end in a one-letter word: ${formatTag(to)} would read back as a shorter tag.`;
  }
  const fromKey = tagKey(from);
  const toKey = tagKey(to);
  if (toKey !== fromKey && isTagWithin(toKey, fromKey)) {
    return `A tag can’t be moved inside itself: ${formatTag(to)} is under ${formatTag(from)}.`;
  }
  return null;
}
