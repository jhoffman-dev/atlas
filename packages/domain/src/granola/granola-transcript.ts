/**
 * A transcript too large for Granola to send inline (its 413) is read a page
 * at a time (plan §5). Past this limit the note is refused rather than read
 * on: a meeting file that size is no meeting anyone reads, and a list that
 * never ends is a fault, not a transcript.
 */
export const TRANSCRIPT_LIMIT = {
  /** Of the turns' words: about five megabytes of English. */
  characters: 5_000_000,
  /** Of up to a hundred turns each. */
  pages: 500,
} as const;

/** Why a note whose transcript passed the limit was refused. */
export const TRANSCRIPT_TOO_LONG = `its transcript is longer than DFAI takes (${TRANSCRIPT_LIMIT.characters.toLocaleString('en-US')} characters, or ${TRANSCRIPT_LIMIT.pages} pages)`;

/** How many characters of words the turns hold; a turn with no text holds none. */
export function transcriptCharacters(turns: readonly unknown[]): number {
  let characters = 0;
  for (const turn of turns) {
    if (typeof turn !== 'object' || turn === null) continue;
    const text: unknown = (turn as { text?: unknown }).text;
    if (typeof text === 'string') characters += text.length;
  }
  return characters;
}

/** Whether a transcript read so far is past the limit. */
export function transcriptOverLimit({
  characters,
  pages,
}: {
  readonly characters: number;
  readonly pages: number;
}): boolean {
  return characters > TRANSCRIPT_LIMIT.characters || pages > TRANSCRIPT_LIMIT.pages;
}
