/**
 * Where the words of `about` are found among some notes (P32-04): the seam
 * `meetings(about)` reads through. Full-text search answers it today
 * (`indexPassageFinder`); semantic search (#33) answers the same question
 * once it is there, and can say which block of a note matched.
 */
export interface PassageFinder {
  find(asked: PassageQuestion): Promise<FoundPassages>;
}

/** What a finder found, and whether that is every note of `within` that holds `about`. */
export interface FoundPassages {
  /** Best first. */
  readonly passages: readonly FoundPassage[];
  /**
   * False when the finder stopped looking before it had covered `within` —
   * its search ranks the whole vault and gives up at a depth — or found more
   * than `limit`: a note that holds `about` may be missing.
   */
  readonly complete: boolean;
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
