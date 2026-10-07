import {
  bookmarkCard,
  bookmarkTarget,
  missingBookmark,
  noteThumbnailKey,
  splitFrontmatter,
  type BookmarkCard,
  type ObjectType,
  type VaultPath,
  type WikiLink,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { modifiedTimes } from '../index/modified-times.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { NoteFile, VaultFsPort } from '../vault/ports.ts';

/** Where a note's cards are, and what they can open. */
export interface BookmarkPlace {
  /** The note the cards are in: a link to one of its own headings opens it. */
  readonly holder: VaultPath;
  /** Every note in the vault, archived ones too: a bookmark to one still opens it. */
  readonly notePaths: readonly VaultPath[];
  /** The type a note names, as the vault defines it now. */
  readonly typeOf: (name: string) => ObjectType | undefined;
}

interface ReadPorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
}

/**
 * What a note's bookmarks show of the notes they link to (U-21): each read
 * from its file, since a card needs the note's properties, its opening
 * paragraph and its pictures — every file in one read, and each once. A link
 * that names no note, or one whose file cannot be read, is shown as missing,
 * so the card says so rather than failing the page. Cards come back in the
 * order of `links`.
 */
export async function readBookmarks({
  links,
  ...rest
}: ReadPorts & BookmarkPlace & { links: readonly WikiLink[] }): Promise<BookmarkCard[]> {
  const paths = links.map((link) => bookmarkTarget({ link, ...rest }));
  const read = await readCards(rest, distinct(paths));
  return inOrder(links, paths, read);
}

/** What one bookmark shows of the note it links to (`readBookmarks`). */
export async function readBookmark({
  link,
  ...rest
}: ReadPorts & BookmarkPlace & { link: WikiLink }): Promise<BookmarkCard> {
  const [card] = await readBookmarks({ ...rest, links: [link] });
  return card ?? missingBookmark(link);
}

/** Reads a note's cards, reading each file again only when it has changed. */
export interface BookmarkReader {
  read(args: BookmarkPlace & { links: readonly WikiLink[] }): Promise<BookmarkCard[]>;
}

/**
 * A reader that keeps each note's card until the index says the note's file
 * has changed (A22-01): a save anywhere in the vault — the note's own
 * autosave above all — then costs one question to the index, not a read of
 * every card's file. An unchanged note's card comes back as the same object.
 * A note the index does not know yet, or an index that cannot be asked, is
 * read from its file: the index only spares reads, it never decides a card.
 */
export function createBookmarkReader({
  index,
  ...ports
}: ReadPorts & { index: IndexPort }): BookmarkReader {
  const kept = new Map<string, ReadCard>();
  return {
    async read({ links, ...place }) {
      const paths = links.map((link) => bookmarkTarget({ link, ...place }));
      const wanted = distinct(paths);
      const modified = wanted.length === 0 ? new Map() : await modifiedTimes(index);
      const stale = wanted.filter((path) => {
        const card = kept.get(path);
        return card === undefined || card.modified !== modified.get(path);
      });
      const read = await readCards({ ...ports, ...place }, stale);
      for (const path of stale) {
        const card = read.get(path);
        if (card === undefined) kept.delete(path);
        else kept.set(path, card);
      }
      return inOrder(links, paths, kept);
    },
  };
}

/** A note's card, and the modification time of the file it was read from. */
interface ReadCard {
  readonly card: BookmarkCard;
  readonly modified: number;
}

/** The cards of the notes at `paths`, read in one go; a file that cannot be read has none. */
async function readCards(
  { fs, markdown, typeOf }: ReadPorts & Pick<BookmarkPlace, 'typeOf'>,
  paths: readonly VaultPath[],
): Promise<Map<string, ReadCard>> {
  if (paths.length === 0) return new Map();
  const files = await fs.readNotes(paths);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const read = new Map<string, ReadCard>();
  for (const path of paths) {
    const file = byPath.get(path);
    if (file === undefined) continue;
    read.set(path, { card: cardOf({ markdown, typeOf, path, file }), modified: file.modified });
  }
  return read;
}

function cardOf({
  markdown,
  typeOf,
  path,
  file,
}: {
  markdown: MarkdownPort;
  typeOf: BookmarkPlace['typeOf'];
  path: VaultPath;
  file: NoteFile;
}): BookmarkCard {
  const { frontmatter, body } = splitFrontmatter(file.text);
  const properties = markdown.frontmatterProperties(frontmatter);
  const typeName = properties['type'];
  const type = typeof typeName === 'string' ? typeOf(typeName) : undefined;
  return bookmarkCard({
    path,
    properties,
    doc: markdown.parseBody(body).doc,
    thumbnailKey: noteThumbnailKey({ type, properties }),
  });
}

/** Each link's card, from the cards read for the notes they open; missing where none was. */
function inOrder(
  links: readonly WikiLink[],
  paths: readonly (VaultPath | null)[],
  cards: ReadonlyMap<string, ReadCard>,
): BookmarkCard[] {
  return links.map((link, at) => {
    const path = paths[at];
    const read = path === null || path === undefined ? undefined : cards.get(path);
    return read?.card ?? missingBookmark(link);
  });
}

/** The notes named, each once, in order. */
const distinct = (paths: readonly (VaultPath | null)[]): VaultPath[] => [
  ...new Set(paths.filter((path): path is VaultPath => path !== null)),
];
