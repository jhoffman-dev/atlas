/**
 * A favourite is a property of the note, not app state in a database.
 *
 * Same reason a view is a note: it diffs, it survives a sync, and it is still
 * there without Atlas. So the whole of the feature is one frontmatter key.
 */

/** The frontmatter key that marks a note as a favourite. */
export const FAVORITE_KEY = 'favorite';

/**
 * How a favourite reads once flattened for the index.
 *
 * YAML's `true`, `True` and `TRUE` all parse to the boolean, whose text form is
 * this, so the index and {@link isFavorite} agree without either of them having
 * to know about the other's spelling.
 */
export const FAVORITE_VALUE = 'true';

/** Whether this note's frontmatter marks it as a favourite. */
export function isFavorite(frontmatter: Readonly<Record<string, unknown>>): boolean {
  return declaresFavorite(frontmatter[FAVORITE_KEY]);
}

function declaresFavorite(declared: unknown): boolean {
  // A list is flattened into one index row per item, and the Favorites section
  // lists the note on any of them — so `favorite: [true]`, which a property
  // editor can leave behind, has to light the star as well.
  if (Array.isArray(declared)) return declared.some(declaresFavorite);
  if (declared === true) return true;
  // A hand-written `favorite: "true"` is a string, and means what it says.
  return typeof declared === 'string' && declared.trim() === FAVORITE_VALUE;
}

/**
 * What to write into `favorite:` to make a note a favourite, or to stop it
 * being one.
 *
 * Unfavouriting clears the key rather than writing `favorite: false`: a note
 * that was never a favourite and one that no longer is should be the same file,
 * or every note anyone ever starred would carry a tombstone for it. Null is how
 * a property is removed everywhere else in Atlas.
 */
export function favoriteValue(favorite: boolean): true | null {
  return favorite ? true : null;
}
