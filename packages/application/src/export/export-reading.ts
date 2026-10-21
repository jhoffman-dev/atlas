import {
  createVaultPath,
  embeddedNotesOf,
  formatWikiLink,
  linkTargetsOf,
  missingTransclusion,
  noteTitle,
  pageTitle,
  resolveWikiLinkTarget,
  shownBlocksOf,
  splitFrontmatter,
  type EditorDocument,
  type EmbeddedNote,
  type RawPartsReader,
  type Transclusion,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { createTransclusionReader } from '../transclusion/read-transclusions.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/*
 * What an export reads besides the note itself: the blocks it shows, the
 * notes it embeds whole, and the title of every note its links name. Shared
 * by every export — to Confluence (P32-07) and out of Atlas (#501) — so each
 * reads them the same way. None of it writes anything.
 */

export interface ExportReadPorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly index: IndexPort;
}

export const readRawOf =
  (markdown: MarkdownPort): RawPartsReader =>
  (raw, definitions) =>
    markdown.rawParts(raw, definitions);

/** What each block the note shows in place shows, by its link as written. */
export async function shownBlocks(
  ports: ExportReadPorts,
  {
    doc,
    holder,
    notePaths,
  }: { doc: EditorDocument; holder: VaultPath; notePaths: readonly VaultPath[] },
): Promise<Map<string, Transclusion>> {
  const links = shownBlocksOf(doc);
  if (links.length === 0) return new Map();
  const read = await createTransclusionReader(ports).read({ links, holder, notePaths });
  return new Map(
    links.map((link, at) => [formatWikiLink(link), read[at] ?? missingTransclusion(link)]),
  );
}

/** A note's title as its page shows it. */
function titleOfFile(markdown: MarkdownPort, file: { path: string; text: string }): string {
  const properties = markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
  return pageTitle({ fileTitle: noteTitle(createVaultPath(file.path)), properties }).text;
}

/** The title of each note the export will name, by the target that names it. */
export async function linkTitles(
  { fs, markdown }: ExportReadPorts,
  { docs, notePaths }: { docs: readonly EditorDocument[]; notePaths: readonly VaultPath[] },
): Promise<Map<string, string>> {
  const pathOf = new Map(
    linkTargetsOf(docs, readRawOf(markdown)).flatMap((target) => {
      const path = resolveWikiLinkTarget(target, notePaths);
      return path === null ? [] : [[target, path] as const];
    }),
  );
  if (pathOf.size === 0) return new Map();
  const files = await fs.readNotes([...new Set(pathOf.values())]);
  const titleAt = new Map(files.map((file) => [file.path, titleOfFile(markdown, file)]));
  return new Map(
    [...pathOf].flatMap(([target, path]) => {
      const found = titleAt.get(path);
      return found === undefined ? [] : [[target, found] as const];
    }),
  );
}

/**
 * Each note `doc` embeds whole, read, by its link as written. One the vault
 * does not hold, or that is the note itself, is left out: it stays words.
 */
export async function embeddedNotes(
  { fs, markdown }: ExportReadPorts,
  {
    doc,
    holder,
    notePaths,
  }: { doc: EditorDocument; holder: VaultPath; notePaths: readonly VaultPath[] },
): Promise<Map<string, EmbeddedNote & { readonly path: VaultPath }>> {
  const pathOf = new Map(
    embeddedNotesOf(doc).flatMap((link) => {
      const path = resolveWikiLinkTarget(link.target, notePaths);
      return path === null || path === holder ? [] : [[formatWikiLink(link), path] as const];
    }),
  );
  if (pathOf.size === 0) return new Map();
  const files = await fs.readNotes([...new Set(pathOf.values())]);
  const noteAt = new Map(
    files.map((file) => {
      const note = {
        path: createVaultPath(file.path),
        title: titleOfFile(markdown, file),
        doc: markdown.parseBody(splitFrontmatter(file.text).body).doc,
      };
      return [file.path, note] as const;
    }),
  );
  return new Map(
    [...pathOf].flatMap(([written, path]) => {
      const found = noteAt.get(path);
      return found === undefined ? [] : [[written, found] as const];
    }),
  );
}
