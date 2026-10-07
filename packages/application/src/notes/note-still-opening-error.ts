/**
 * A write through a pane refused because the pane has not finished reading
 * the note yet. Nothing was written, and the same write a moment later can
 * land: the caller may simply retry.
 */
export class NoteStillOpeningError extends Error {
  constructor(path: string) {
    super(`${path} is still opening in its pane`);
    this.name = 'NoteStillOpeningError';
  }
}
