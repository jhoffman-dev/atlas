import type { BodyRange, EditorDocument, ParsedBody, RawPart } from '@atlas/domain';

/**
 * Turning markdown into an editable document and back. The implementation is a
 * markdown library; the use-cases only need the two directions.
 */
export interface MarkdownPort {
  parseBody(body: string): ParsedBody;
  /** Frontmatter read as plain values, for indexing. Never used to write it back. */
  frontmatterProperties(frontmatter: string | null): Record<string, unknown>;
  /**
   * Why a frontmatter block cannot be read, in one line; null when it can. The
   * properties of such a block read as none, which is right for indexing but
   * not for a file whose settings would then quietly vanish.
   */
  frontmatterProblem(frontmatter: string | null): string | null;
  /** The note's words with the markup removed, for full-text search. */
  plainText(body: string): string;
  /**
   * Where the body's plain words are, by offset: the text the parser read
   * outside any link, reference, footnote, code or HTML.
   */
  textRanges(body: string): BodyRange[];
  /**
   * Each top-level key of the block with the exact text that writes it, for
   * giving it back byte for byte later as a `KeyAsWritten` change. Nothing
   * for a note with no block, or a block whose keys cannot be told apart by line.
   */
  frontmatterKeyTexts(frontmatter: string | null): Record<string, string>;
  /**
   * Changes some frontmatter keys and leaves the rest of the block — its
   * formatting, comments and key order — exactly as it was. A change whose
   * value is null or undefined removes the key rather than writing it; one
   * given as `KeyAsWritten` is written as exactly that text, when it is that
   * key alone, and otherwise removes it.
   */
  updateFrontmatter(frontmatter: string | null, changes: Readonly<Record<string, unknown>>): string;
  serializeBody(args: { originalBody: string; parsed: ParsedBody; doc: EditorDocument }): string;
  /**
   * What markdown the editor does not model holds that an export rewrites
   * (P32-07): its links, images, definitions, footnotes, HTML, ids and
   * quotes, by offset, read with `definitions` — the note's own, each as its
   * markdown — in reach, as the note reads them. Nothing in code.
   */
  rawParts(markdown: string, definitions: readonly string[]): RawPart[];
}
