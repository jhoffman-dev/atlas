import {
  anchoredBlocks,
  mayHoldBlockIds,
  compileRelationHoldersQuery,
  createVaultPath,
  createWikiLinkResolver,
  digestOf,
  linkedName,
  noteChangesBetween,
  RELATION_NAMES_PER_QUERY,
  indexablePropertiesOf,
  noteTags,
  noteTitle,
  pageTitle,
  relationsOf,
  summaryOf,
  splitFrontmatter,
  splitWikiLinks,
  TAGS_KEY,
  type NoteChange,
  type NoteVersion,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import { listVaultNoteFiles } from '../vault/read-vault.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { noteTypeName } from '../types/load-types.ts';
import type { IndexedNote, IndexEntry, IndexPort } from './ports.ts';

/** Notes are read and written in batches so a large vault is not one huge message. */
const BATCH_SIZE = 200;

export interface IndexRefresh {
  readonly indexed: number;
  readonly removed: number;
  readonly unchanged: number;
  /** Each note added, changed or removed since `previous` (P28-03); none when nothing was. */
  readonly changes: readonly NoteChange[];
}

export interface RefreshOptions {
  fs: VaultFsPort;
  index: IndexPort;
  markdown: MarkdownPort;
  /** Called after each batch, for showing progress on a big vault. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Every note as it was when the vault was last looked at, which `changes`
   * is measured from. Left out, it is what the index holds — which a rebuild
   * has just cleared, and a delete in the app has already let go of.
   */
  previous?: ReadonlyMap<string, NoteVersion>;
}

/**
 * Brings the index in line with the vault.
 *
 * Only notes whose size or modification time differ are re-read, so an ordinary
 * launch does almost no work. Deciding what a note contains happens here rather
 * than in the host, so the index always agrees with what the editor would show.
 *
 * It indexes user space, through the same listing the editor resolves links
 * against — a note that is not a link target must not be a search result either.
 */
export async function refreshIndex({
  fs,
  index,
  markdown,
  onProgress,
  previous,
}: RefreshOptions): Promise<IndexRefresh> {
  const notes = await listVaultNoteFiles({ fs });
  const current = new Map<string, (typeof notes)[number]>(
    notes.map((note) => [note.path as string, note]),
  );
  const known = new Map((await index.manifest()).map((entry) => [entry.path, entry]));

  const stale = [...current.values()].filter((note) => {
    const entry = known.get(note.path);
    return entry === undefined || entry.modified !== note.modified || entry.size !== note.size;
  });

  const removed = [...known.keys()].filter((path) => !current.has(path));
  if (removed.length > 0) await index.remove(removed.map(createVaultPath));

  // A note made or gone can change which note an unchanged note's relation means.
  const added = [...current.keys()].filter((path) => !known.has(path));
  const staleByRelation = await relationHolders(index, [...added, ...removed]);
  const stalePaths = new Set(stale.map((note) => note.path as string));
  for (const path of staleByRelation) {
    const note = current.get(path);
    if (note !== undefined && !stalePaths.has(path)) {
      stale.push(note);
      stalePaths.add(path);
    }
  }

  const notePaths = [...current.keys()].map(createVaultPath);
  const reread = await indexNotes({
    fs,
    index,
    markdown,
    notePaths,
    stale,
    ...(onProgress !== undefined && { onProgress }),
  });

  return {
    indexed: stale.length,
    removed: removed.length,
    unchanged: current.size - stale.length,
    changes: noteChangesBetween(previous ?? known, versionsNow(current.keys(), reread, known)),
  };
}

/** Reads and indexes the stale notes in batches; answers with what was read, by path. */
async function indexNotes({
  fs,
  index,
  markdown,
  notePaths,
  stale,
  onProgress,
}: Omit<RefreshOptions, 'previous'> & {
  notePaths: readonly VaultPath[];
  stale: readonly { path: VaultPath }[];
}): Promise<Map<string, IndexedNote>> {
  // One resolver for the whole refresh: every link in every note asks it.
  const resolveLink = createWikiLinkResolver(notePaths);
  const reread = new Map<string, IndexedNote>();
  let done = 0;

  for (let offset = 0; offset < stale.length; offset += BATCH_SIZE) {
    const batch = stale.slice(offset, offset + BATCH_SIZE);
    const files = await fs.readNotes(batch.map((note) => note.path));
    const notes = files.map((file) => toIndexedNote({ file, notePaths, markdown, resolveLink }));
    await index.put(notes);
    for (const note of notes) reread.set(note.path, note);

    done += batch.length;
    onProgress?.(done, stale.length);
  }
  return reread;
}

/**
 * Every note in the vault as it is now: as just read, or as the index already
 * had it. A note listed but neither — gone before it could be read — is left
 * out, and the next refresh finds it gone.
 */
function versionsNow(
  paths: Iterable<string>,
  reread: ReadonlyMap<string, NoteVersion>,
  known: ReadonlyMap<string, IndexEntry>,
): Map<string, NoteVersion> {
  const versions = new Map<string, NoteVersion>();
  for (const path of paths) {
    const version = reread.get(path) ?? known.get(path);
    if (version !== undefined) versions.set(path, version);
  }
  return versions;
}

/**
 * Takes notes the app has just moved or deleted out of the index at once, and
 * with them every note whose relation named them. The refresh that follows
 * cannot see a removal it did not make, so it would never re-resolve those
 * relations; taken out too, the holders are read again as new notes.
 */
export async function forgetNotes(index: IndexPort, paths: readonly VaultPath[]): Promise<void> {
  if (paths.length === 0) return;
  const holders = await relationHolders(index, paths);
  await index.remove([...new Set<string>([...paths, ...holders])].map(createVaultPath));
}

/**
 * The indexed notes holding a relation written as the name of one of these
 * notes — asked before those notes' own rows change, so a note that has gone
 * is still there to be pointed at.
 */
async function relationHolders(index: IndexPort, changed: readonly string[]): Promise<string[]> {
  const names = [...new Set(changed.map(linkedName))];
  const holders: string[] = [];
  for (let offset = 0; offset < names.length; offset += RELATION_NAMES_PER_QUERY) {
    const { sql, parameters } = compileRelationHoldersQuery(
      names.slice(offset, offset + RELATION_NAMES_PER_QUERY),
    );
    const result = await index.query(sql, parameters);
    holders.push(...result.rows.map((row) => String(row[0])));
  }
  return holders;
}

/** Everything the index should know about one note. */
export function toIndexedNote({
  file,
  notePaths,
  markdown,
  resolveLink = createWikiLinkResolver(notePaths),
}: {
  file: { path: string; text: string; modified: number; size: number };
  notePaths: readonly VaultPath[];
  markdown: MarkdownPort;
  /** How a link finds its note among `notePaths` — built once when many notes are read. */
  resolveLink?: (target: string) => VaultPath | null;
}): IndexedNote {
  const path = createVaultPath(file.path);
  const document = splitFrontmatter(file.text);
  const frontmatter = markdown.frontmatterProperties(document.frontmatter);

  const body = markdown.plainText(document.body);

  return {
    path: file.path,
    title: pageTitle({ fileTitle: noteTitle(path), properties: frontmatter }).text,
    modified: file.modified,
    size: file.size,
    type: noteTypeName(frontmatter),
    digest: digestOf(file.text),
    body,
    summary: summaryOf(document.body),
    properties: indexablePropertiesOf(frontmatter),
    links: linksIn(document.body, resolveLink),
    relations: relationsOf(frontmatter, resolveLink),
    tags: noteTags({
      tagsProperty: frontmatter[TAGS_KEY],
      body: document.body,
      ranges: markdown.textRanges(document.body),
    }),
    blocks: blocksIn(document.body, markdown),
  };
}

/**
 * The note's blocks with ids (P26-01), read as the editor reads them. A body
 * with no line ending as an id would has none, and is not parsed for them.
 */
function blocksIn(body: string, markdown: MarkdownPort) {
  return mayHoldBlockIds(body) ? anchoredBlocks(markdown.parseBody(body).doc) : [];
}

function linksIn(body: string, resolveLink: (target: string) => VaultPath | null) {
  return splitWikiLinks(body)
    .filter((piece) => piece.kind === 'wikiLink')
    .map((link) => ({
      target: link.target,
      path: resolveLink(link.target),
      kind: 'wikilink' as const,
    }));
}
