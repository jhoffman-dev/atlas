/**
 * One way a meeting file breaks the import contract (ADR-0027), said so that
 * whoever wrote the mapping can fix it: which key or section, what is wrong,
 * and on which line of the file when it is on one.
 */
export interface MeetingImportError {
  /** Where the problem is: `frontmatter` keys or the `body`'s sections. */
  readonly in: 'frontmatter' | 'body';
  /** The key (`title`, `attendees[1].email`) or section (`Transcript`) at fault. */
  readonly field: string;
  readonly message: string;
  /** The 1-based line of the file, or null when the problem is not on one line. */
  readonly line: number | null;
}

/** A problem in the body, on a line of the file. */
export function bodyError(field: string, message: string, line: number): MeetingImportError {
  return { in: 'body', field, message, line };
}

/** A problem with a frontmatter key, which YAML does not place on a line for us. */
export function frontmatterError(field: string, message: string): MeetingImportError {
  return { in: 'frontmatter', field, message, line: null };
}
