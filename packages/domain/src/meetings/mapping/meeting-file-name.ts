/** Where a meeting arrives in the vault (ADR-0027): `MEETING_INBOX`, which this mapper cannot import. */
export const MEETINGS_FOLDER = 'Inbox/Meetings';

/** The most bytes a file name may have on macOS (the vault's `MAX_NAME_BYTES`). */
const MAX_NAME_BYTES = 255;

/**
 * The UTF-8 length of `text`, counted by code point: n8n's Code node sandbox
 * is not documented to have TextEncoder.
 */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const each of text) {
    const point = each.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * The text as a reader sees its characters: grapheme clusters where
 * Intl.Segmenter exists, else code points (never half an emoji either way;
 * only a joined emoji like a family may then be cut between its parts).
 */
function characters(text: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return [...text];
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  return Array.from(segments, (each) => each.segment);
}

/**
 * The title as a file name, by the vault's rule (`cleanEntryName`): no path
 * separators, nothing Finder or Windows refuses, no control characters, no
 * leading or trailing dots and spaces. Also without `#`, `^`, `[` and `]`:
 * the vault allows them, but they break a `[[wiki link]]` to the note, and
 * n8n's GitHub node puts the path into a URL where `#` ends it.
 */
export function fileTitle(title: string): string {
  return title
    .replace(/[/\\:*?"<>|#^[\]]|\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '');
}

/**
 * `stem` cut by whole characters as a reader sees them — never half an emoji —
 * until it and `ending` fit in a file name (the vault's `fitFileNameStem`).
 */
export function fitStem(stem: string, ending: string): string {
  const room = MAX_NAME_BYTES - utf8Bytes(ending);
  if (utf8Bytes(stem) <= room) return stem;
  let kept = '';
  let keptBytes = 0;
  for (const character of characters(stem)) {
    keptBytes += utf8Bytes(character);
    if (keptBytes > room) break;
    kept += character;
  }
  return kept.trimEnd();
}

/** The longest a provider name may run in the collision suffix (it is `[a-z0-9-]`: a byte a character). */
const MAX_SUFFIX_PROVIDER = 40;

/**
 * A short hash of the text: 32-bit FNV-1a over its UTF-16 code units, as 8
 * hex digits. Not for security; it tells one meeting's id from another's
 * where the id itself cannot go in a file name (`a/b` and `a b` both clean
 * to `a b`) or would not fit.
 */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The meeting's two possible paths: the contract's, and one that also names the meeting. */
export interface MeetingPaths {
  /** `Inbox/Meetings/<YYYY-MM-DD> <title>.md`. */
  readonly path: string;
  /**
   * `Inbox/Meetings/<YYYY-MM-DD> <title> (<provider> <hash>).md`, the hash of
   * provider and id: where a meeting goes when another meeting already holds
   * its plain path — two `1:1`s on one day. Within 255 bytes however long the
   * id, with the date kept. Meant to be this meeting's alone; the workflow
   * still checks a file there is this meeting before skipping.
   */
  readonly collisionPath: string;
}

export function meetingPaths({
  date,
  title,
  provider,
  externalId,
}: {
  date: string;
  title: string;
  provider: string;
  externalId: string;
}): MeetingPaths {
  const stem = `${date} ${fileTitle(title) || 'Untitled'}`;
  const hash = shortHash(`${provider}\n${externalId}`);
  const suffix = ` (${provider.slice(0, MAX_SUFFIX_PROVIDER)} ${hash})`;
  return {
    path: `${MEETINGS_FOLDER}/${fitStem(stem, '.md')}.md`,
    collisionPath: `${MEETINGS_FOLDER}/${fitStem(stem, `${suffix}.md`)}${suffix}.md`,
  };
}
