import {
  cardFront,
  splitFrontmatter,
  thumbnailPropertyOf,
  type CardFront,
  type EditorDocument,
  type ObjectType,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from './ports.ts';

/** A note as a feed or a gallery card shows it: its body as a document, and what fronts it. */
export interface NotePreview {
  readonly path: string;
  readonly doc: EditorDocument;
  /** What fronts its card, its type's thumbnail property first when it has one (`cardFront`). */
  readonly front: CardFront;
  /** When the file last changed, as the host said: what a picture of its page is compared with. */
  readonly modified: number;
}

/** How many notes one read asks the host for. */
export const PREVIEW_BATCH = 12;

/**
 * Reads the bodies of the notes a feed or gallery is about to show.
 *
 * The index keeps a note's words for searching, not its markdown, so a body
 * drawn with its headings, lists and links has to come from the file. One
 * batched read per call, capped at `PREVIEW_BATCH`: a view of five hundred
 * tasks reads the ones on screen, not the vault. A note the host cannot read
 * is simply absent from the result — its card shows its title and fields.
 */
export async function readNotePreviews({
  fs,
  markdown,
  paths,
  type = null,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  paths: readonly string[];
  /** The type the notes are of, whose thumbnail property fronts their cards. */
  type?: ObjectType | null;
}): Promise<NotePreview[]> {
  const files = await fs.readNotes(paths.slice(0, PREVIEW_BATCH));
  // The view's type says how all its cards are drawn: a note's own thumbnail
  // fronts its pane, but a gallery of a type without one draws no pages.
  const thumbnailKey = thumbnailPropertyOf(type);
  return files.map((file) => {
    const { frontmatter, body } = splitFrontmatter(file.text);
    const { doc } = markdown.parseBody(body);
    const properties = markdown.frontmatterProperties(frontmatter);
    return {
      path: file.path,
      doc,
      front: cardFront({ properties, doc, thumbnailKey }),
      modified: file.modified,
    };
  });
}
