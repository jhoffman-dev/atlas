import { joinFrontmatter, type EditorDocument } from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from './ports.ts';
import type { OpenNote } from './open-note.ts';

export interface SavedNote {
  readonly note: OpenNote;
  /** The full file text that was written, frontmatter included. */
  readonly text: string;
}

/**
 * Writes the edited document back to the note.
 *
 * The frontmatter is re-attached exactly as it was read, and blocks the user did
 * not touch keep their original bytes. The save is refused outright if the file
 * changed on disk since it was opened, rather than overwriting the other change.
 */
export async function saveNote({
  fs,
  markdown,
  note,
  doc,
  changes,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  note: OpenNote;
  doc: EditorDocument;
  /**
   * Frontmatter keys to change as part of this save. Going through the same write
   * as the body means editing a property can never discard unsaved body edits.
   */
  changes?: Readonly<Record<string, unknown>>;
}): Promise<SavedNote> {
  const body = markdown.serializeBody({
    originalBody: note.originalBody,
    parsed: note.parsed,
    doc,
  });
  const frontmatter =
    changes === undefined || Object.keys(changes).length === 0
      ? note.frontmatter
      : markdown.updateFrontmatter(note.frontmatter, changes);
  const text = joinFrontmatter(frontmatter, body);

  const modified = await fs.writeTextFile({
    path: note.path,
    contents: text,
    expectedModified: note.modified,
  });

  // Re-parse so the next save compares against what is now on disk.
  const parsed = markdown.parseBody(body);
  return {
    text,
    note: {
      ...note,
      frontmatter,
      properties: markdown.frontmatterProperties(frontmatter),
      originalBody: body,
      parsed,
      doc: parsed.doc,
      modified,
    },
  };
}
