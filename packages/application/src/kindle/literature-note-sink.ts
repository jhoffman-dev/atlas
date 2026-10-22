import {
  createVaultPath,
  freeNotePath,
  kindleLiteratureNote,
  kindleNoteMatch,
  kindleNoteOf,
  LIBRARY_HOME,
  LITERATURE_NOTE_TYPE,
  literatureNotePath,
  literatureNoteText,
  readLiteratureNote,
  recordedKindleKeys,
  splitFrontmatter,
  withKindleHighlights,
  type KindleBook,
  type KindleHighlight,
  type VaultPath,
} from '@dfai/domain';
import {
  changeLiteratureNote,
  type LiteratureNoteWritePorts,
} from '../highlights/literature-note-writes.ts';
import type { IndexPort } from '../index/ports.ts';
import { homeFolderFor } from '../notes/home-folder.ts';
import type { Clock, Rng } from '../ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import type { KindleHighlightSink } from './ports.ts';

/** What Kindle sync needs to find, make and write a book's literature note. */
export interface LiteratureNoteKindleSinkPorts extends LiteratureNoteWritePorts {
  readonly fs: VaultFsPort;
  readonly index: Pick<IndexPort, 'notesOfType'>;
  readonly rng: Rng;
  /** Today, for a home folder the vault's literature type names by date. */
  readonly clock: Pick<Clock, 'today'>;
}

/** How many times a new note is named again after another took its name meanwhile. */
const CREATE_ATTEMPTS = 3;

/**
 * Kindle sync's sink over the vault's literature notes (#503, #508): a book's
 * highlights go into its literature note, found by ASIN, else by title and
 * author (`kindleNoteOf`), and made in the literature home folder when there
 * is none — under a name of its own, never over another note. What a note
 * has recorded is read from the note (`recordedKindleKeys`), and a book is
 * written in one write (`withKindleHighlights` through `changeLiteratureNote`),
 * or not at all. A note with unsaved typing in a pane is not written behind:
 * `addHighlights` throws `UnsavedTypingError`, and the sync leaves that book
 * for next time.
 *
 * The note found for each book is remembered for as long as the sink lives,
 * and looked at again before it is used, so a note renamed, moved or retitled
 * is looked for afresh.
 */
export function literatureNoteKindleSink(
  ports: LiteratureNoteKindleSinkPorts,
): KindleHighlightSink {
  const found = new Map<string, VaultPath>();

  async function noteOf(book: KindleBook): Promise<VaultPath | null> {
    const known = found.get(book.asin);
    if (known !== undefined && (await stillTheBooks(ports, known, book))) return known;
    found.delete(book.asin);
    const path = await findNote(ports, book);
    if (path !== null) found.set(book.asin, path);
    return path;
  }

  return {
    async recordedKeys(book) {
      const path = await noteOf(book);
      if (path === null) return new Set();
      const { text } = await ports.fs.readTextFile(path);
      return recordedKindleKeys(text, book.asin, (note) => ports.markdown.noteBlocks(note));
    },
    async addHighlights({ book, highlights }) {
      const path = await noteOf(book);
      if (path === null) {
        found.set(book.asin, await createNote(ports, book, highlights));
        return;
      }
      if (ports.openNotes.state(path) === 'dirty') throw new UnsavedTypingError(path);
      const change = (text: string) => written(ports, { text, book, highlights });
      await changeLiteratureNote(ports, { path, change });
    },
  };
}

function written(
  ports: Pick<LiteratureNoteKindleSinkPorts, 'markdown' | 'rng'>,
  args: { text: string; book: KindleBook; highlights: readonly KindleHighlight[] },
): string {
  return withKindleHighlights({
    text: args.text,
    asin: args.book.asin,
    highlights: args.highlights,
    random: () => ports.rng.next(),
    noteBlocks: (note) => ports.markdown.noteBlocks(note),
  }).text;
}

/** Literature notes, as the index knows them and as the home folder holds them now. */
async function candidatesFor(
  ports: LiteratureNoteKindleSinkPorts,
  folder: VaultPath,
): Promise<string[]> {
  const indexed = (await ports.index.notesOfType(LITERATURE_NOTE_TYPE)).map((note) => note.path);
  // A note this sync made moments ago may not be indexed yet; its folder already holds it.
  // A folder that cannot be listed has not been made yet, and holds no note to find.
  const listed = await ports.fs.listDirectory(folder).catch(() => []);
  const inFolder = listed
    .filter((entry) => entry.kind === 'file' && entry.path.endsWith('.md'))
    .map((entry) => entry.path);
  return [...new Set([...indexed, ...inFolder])].sort();
}

/** The book's note in the vault, or null when it has none. */
async function findNote(
  ports: LiteratureNoteKindleSinkPorts,
  book: KindleBook,
): Promise<VaultPath | null> {
  const folder = await homeFolder(ports);
  const files = await ports.fs.readNotes(await candidatesFor(ports, folder));
  const notes = files.map((file) => ({
    path: file.path,
    note: readLiteratureNote(frontmatterOf(ports, file.text)),
  }));
  const path = kindleNoteOf(notes, book);
  return path === null ? null : createVaultPath(path);
}

/** Whether the note at `path` is still `book`'s: there, and saying so. */
async function stillTheBooks(
  ports: LiteratureNoteKindleSinkPorts,
  path: VaultPath,
  book: KindleBook,
): Promise<boolean> {
  const [file] = await ports.fs.readNotes([path]);
  if (file === undefined) return false;
  return kindleNoteMatch(readLiteratureNote(frontmatterOf(ports, file.text)), book) !== null;
}

function frontmatterOf(ports: Pick<LiteratureNoteKindleSinkPorts, 'markdown'>, text: string) {
  return ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
}

/** Where a new literature note goes: the folder the vault's literature type names, else `Library`. */
async function homeFolder(ports: LiteratureNoteKindleSinkPorts): Promise<VaultPath> {
  const named = await homeFolderFor({
    fs: ports.fs,
    markdown: ports.markdown,
    properties: { type: LITERATURE_NOTE_TYPE },
    today: ports.clock.today(),
  });
  return named ?? createVaultPath(LIBRARY_HOME);
}

/**
 * Makes the book's note with its highlights already in it, in one write,
 * named after the book and numbered past any name taken (`Persuasion 2.md`),
 * so no note is ever written over. A name taken between the listing and the
 * write is the disk's refusal; the name is chosen again.
 */
async function createNote(
  ports: LiteratureNoteKindleSinkPorts,
  book: KindleBook,
  highlights: readonly KindleHighlight[],
): Promise<VaultPath> {
  const folder = await ensureFolder({ fs: ports.fs, folder: await homeFolder(ports) });
  const contents = written(ports, {
    text: literatureNoteText(kindleLiteratureNote(book)),
    book,
    highlights,
  });
  for (let attempt = 1; ; attempt += 1) {
    const taken = new Set((await ports.fs.listDirectory(folder)).map((entry) => entry.path));
    const path = freeNotePath(literatureNotePath(book.title, folder), taken);
    try {
      await ports.fs.createNote({ path, contents });
      return path;
    } catch (error) {
      // Another write took the name since the listing; the next round lists and names again.
      if (attempt === CREATE_ATTEMPTS) throw error;
    }
  }
}
