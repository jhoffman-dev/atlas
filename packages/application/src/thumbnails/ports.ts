import type { EditorDocument } from '@atlas/domain';

/**
 * Drawing a note's body as the app draws it to be read, as HTML: the
 * editor's own schema, so every piece of text is escaped and a block of raw
 * HTML is shown as its source, never run.
 */
export interface NotePageRenderer {
  bodyHtml(doc: EditorDocument): string;
  /** The app's page look in the light theme, its fonts written in: nothing is fetched. */
  readonly styles: string;
}

/** A thumbnail that cannot be made, for a reason the person can act on; the message says what. */
export class ThumbnailRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThumbnailRefusedError';
  }
}
