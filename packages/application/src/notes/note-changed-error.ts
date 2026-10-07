/**
 * A write refused because the note is no longer the one the caller read.
 *
 * Raised before anything is written, when the caller said which modification
 * time it read the note at and the note on disk now has another.
 */
export class NoteChangedError extends Error {
  constructor(path: string) {
    super(`${path} changed since it was read`);
    this.name = 'NoteChangedError';
  }
}
