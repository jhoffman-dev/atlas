import {
  splitFrontmatter,
  type EditorDocument,
  type ParsedBody,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from './ports.ts';

/** A note open in the editor, with everything needed to write it back faithfully. */
export interface OpenNote {
  readonly path: VaultPath;
  /** The note's frontmatter, carried through untouched. */
  readonly frontmatter: string | null;
  /** The same block read as values, for the properties panel. Never written back. */
  readonly properties: Readonly<Record<string, unknown>>;
  readonly originalBody: string;
  readonly parsed: ParsedBody;
  readonly doc: EditorDocument;
  /** The file's modification time when it was read, used to detect outside edits. */
  readonly modified: number;
}

export async function openNote({
  fs,
  markdown,
  path,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: VaultPath;
}): Promise<OpenNote> {
  const { text, modified } = await fs.readTextFile(path);
  const document = splitFrontmatter(text);
  const parsed = markdown.parseBody(document.body);

  return {
    path,
    frontmatter: document.frontmatter,
    properties: markdown.frontmatterProperties(document.frontmatter),
    originalBody: document.body,
    parsed,
    doc: parsed.doc,
    modified,
  };
}
