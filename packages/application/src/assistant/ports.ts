/**
 * Where the words of `about` are found among some notes (P32-04): the seam
 * `meetings(about)` reads through. Full-text search answers it today
 * (`indexPassageFinder`); semantic search (#33) answers the same question
 * once it is there, and can say which block of a note matched.
 */
export interface PassageFinder {
  find(asked: PassageQuestion): Promise<readonly FoundPassage[]>;
}

export interface PassageQuestion {
  /** What the passages are about, as the caller wrote it. */
  readonly about: string;
  /** The only notes worth an answer: a page's meetings. */
  readonly within: readonly string[];
  /** At most this many notes. */
  readonly limit: number;
}

/** A note that holds `about`, best first. */
export interface FoundPassage {
  readonly path: string;
  /**
   * The blocks of the note that matched, by id, when the finder can say;
   * null when it found the note only, and its turns are matched by their words.
   */
  readonly blocks: readonly string[] | null;
}
