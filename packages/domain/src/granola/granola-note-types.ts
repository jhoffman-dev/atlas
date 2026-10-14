/**
 * Granola's notes as its public API sends them (OpenAPI, `NoteSummary` and
 * `Note`), under the API's own field names: the note goes to the mapper
 * (`mapGranolaNote`) as it came. Only what the pull itself reads is typed and
 * checked on the way in; the rest is the mapper's to read, and it refuses by
 * name what it cannot.
 */

/** A note as `GET /v1/notes` lists it. */
export interface GranolaNoteSummary {
  /** `not_` and fourteen letters or digits. */
  readonly id: string;
  readonly title: string | null;
  /** RFC 3339: when the note last changed, which the watermark is kept in. */
  readonly updated_at: string;
  readonly [field: string]: unknown;
}

/** A note as `GET /v1/notes/{id}` sends it, with its transcript when asked for and small enough. */
export interface GranolaNote {
  readonly id: string;
  readonly title: string | null;
  readonly updated_at: string;
  /** The note in Granola's web app; what a refusal points the person to. */
  readonly web_url: string | null;
  /** Each item a turn (`speaker`, `text`, `start_time`, `end_time`); null when not asked for. */
  readonly transcript: readonly unknown[] | null;
  readonly [field: string]: unknown;
}

/**
 * A note the list named in a shape the API does not document — an id that is
 * not one, a title that is not text, no `updated_at` — left out of the pull.
 * Never the note's content: only its id, when it is text, and why.
 */
export interface GranolaUnreadableSummary {
  readonly id: string | null;
  /** What about it is not as documented, in fixed words. */
  readonly reason: string;
}
