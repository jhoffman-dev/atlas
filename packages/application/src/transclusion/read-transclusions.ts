import {
  bookmarkTarget,
  missingTransclusion,
  splitFrontmatter,
  transclusionOf,
  type EditorDocument,
  type Transclusion,
  type VaultPath,
  type WikiLink,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { modifiedTimes } from '../index/modified-times.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** Where a note's shown blocks are, and the notes they can come from. */
export interface TransclusionPlace {
  /** The note they are in: `![[#^id]]` names one of its own blocks. */
  readonly holder: VaultPath;
  /** Every note in the vault, archived ones too: a block of one is still shown. */
  readonly notePaths: readonly VaultPath[];
}

/** Reads a note's shown blocks, reading each note they come from again only when it has changed. */
export interface TransclusionReader {
  read(args: TransclusionPlace & { links: readonly WikiLink[] }): Promise<Transclusion[]>;
}

/** A note as its shown blocks need it, and when its file was last changed. */
interface ReadNote {
  readonly doc: EditorDocument;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly modified: number;
}

/**
 * What a note's shown blocks show (P26-03): each block, or the section under
 * each heading, read from the note its link names — every note once, and
 * again only when the index says its file has changed, so a save anywhere in
 * the vault costs one question to the index. A link to no note, or to a note
 * that cannot be read, shows as missing; one to a block the note no longer
 * has shows that. The results come back in the order of `links`.
 */
export function createTransclusionReader({
  fs,
  markdown,
  index,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
}): TransclusionReader {
  const kept = new Map<string, ReadNote>();
  return {
    async read({ links, holder, notePaths }) {
      const paths = links.map((link) => bookmarkTarget({ link, holder, notePaths }));
      const wanted = [...new Set(paths.filter((path): path is VaultPath => path !== null))];
      const modified = wanted.length === 0 ? new Map() : await modifiedTimes(index);
      // A note the index does not know, or an index that cannot be asked, is
      // read from its file: the index only spares reads, it never decides one.
      const stale = wanted.filter((path) => {
        const note = kept.get(path);
        return note === undefined || note.modified !== modified.get(path);
      });
      const read = await readNotes({ fs, markdown }, stale);
      for (const path of stale) {
        const note = read.get(path);
        if (note === undefined) kept.delete(path);
        else kept.set(path, note);
      }
      return links.map((link, at) => {
        const path = paths[at] ?? null;
        const note = path === null ? undefined : kept.get(path);
        if (path === null || note === undefined) return missingTransclusion(link);
        return transclusionOf({ link, path, properties: note.properties, doc: note.doc });
      });
    },
  };
}

/** The notes at `paths`, read in one go; a file that cannot be read has none. */
async function readNotes(
  { fs, markdown }: { fs: VaultFsPort; markdown: MarkdownPort },
  paths: readonly VaultPath[],
): Promise<Map<string, ReadNote>> {
  if (paths.length === 0) return new Map();
  const read = new Map<string, ReadNote>();
  for (const file of await fs.readNotes(paths)) {
    const { frontmatter, body } = splitFrontmatter(file.text);
    read.set(file.path, {
      doc: markdown.parseBody(body).doc,
      properties: markdown.frontmatterProperties(frontmatter),
      modified: file.modified,
    });
  }
  return read;
}
