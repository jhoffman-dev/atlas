import { freeNotePath, isArchivedPath } from '../archive/archive.ts';
import { wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { FILED_UNDER, FILED_UNDER_KEY } from '../types/para.ts';
import { relationTypeRefusal } from '../types/property-value.ts';
import {
  joinVaultPath,
  parentVaultPath,
  vaultPathName,
  VAULT_ROOT,
  type VaultPath,
} from '../vault/vault-path.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import {
  isAtlasNote,
  isUserSpaceNote,
  isWithinWalk,
  userSpaceNoteSql,
} from '../vault/vault-visibility.ts';

/**
 * Where everything arrives before it is processed: a folder at the root of
 * the vault. Captured tasks land in it, imported meetings in `Inbox/Meetings`
 * (ADR-0027); processing files each one under a project or an area (P30-01).
 */
export const INBOX_DIRECTORY = 'Inbox';

/** The start of every path in the Inbox, lower-cased: the disk does not tell `Inbox` from `inbox`. */
export const INBOX_PREFIX = `${INBOX_DIRECTORY.toLowerCase()}/`;

const MARKDOWN = /\.(md|markdown)$/i;

/** Whether a note sits in the Inbox, at any depth. */
export function isInInbox(path: string): boolean {
  return path.toLowerCase().startsWith(INBOX_PREFIX);
}

/** A note waiting in the Inbox, as the Inbox lists it. */
export interface InboxItem {
  readonly path: VaultPath;
  readonly title: string;
  /** Its `type:`, or null for a plain note. */
  readonly type: string | null;
  /** The folder it arrived in under the Inbox — `Meetings` — or '' for the Inbox itself. */
  readonly arrivedIn: string;
}

/** How many notes the Inbox lists at once. */
export const INBOX_LIST_LIMIT = 500;

/** What the Inbox's statement starts with, so a log or a stand-in index can tell it apart. */
export const INBOX_QUERY_MARK = '/* inbox */';

/** The columns {@link compileInboxQuery} comes back as, in order. */
export const INBOX_QUERY_COLUMNS = ['path', 'title', 'type'] as const;

/**
 * The Inbox's notes, asked of the index: newest first, so what just arrived
 * is on top, then by title so the list never reshuffles.
 */
export function compileInboxQuery({
  limit = INBOX_LIST_LIMIT,
}: { limit?: number } = {}): CompiledQuery {
  return {
    sql: [
      `${INBOX_QUERY_MARK} SELECT files.path AS "path", files.title AS "title",`,
      `  (SELECT p.value_text FROM props AS p WHERE p.path = files.path AND p.key = 'type' ORDER BY p.idx LIMIT 1) AS "type"`,
      `FROM files`,
      `WHERE lower(substr(files.path, 1, ${INBOX_PREFIX.length})) = '${INBOX_PREFIX}'`,
      `  AND ${userSpaceNoteSql('files.path')}`,
      `ORDER BY files.modified DESC, lower(files.title), files.path`,
      `LIMIT ?`,
    ].join('\n'),
    parameters: [Math.max(1, Math.floor(limit))],
  };
}

/** A row of {@link compileInboxQuery}, as the Inbox lists it. */
export function inboxItem({
  path,
  title,
  type,
}: {
  path: VaultPath;
  title: string;
  type: unknown;
}): InboxItem {
  const within = parentVaultPath(path).split('/').slice(1).join('/');
  const declared = typeof type === 'string' && type.trim() !== '' ? type.trim() : null;
  return { path, title, type: declared, arrivedIn: within };
}

/** Why a note cannot be processed out of the Inbox, or null when it can. */
export function processRefusal(path: VaultPath): string | null {
  if (!isInInbox(path)) return 'It is not in the Inbox.';
  if (!MARKDOWN.test(path)) return 'Only notes can be processed.';
  return null;
}

/**
 * Why a note cannot be what Inbox notes are filed under, or null when it can:
 * it has to be a project or an area, and one still in use — not waiting in
 * the Inbox itself, not archived, not one of Atlas's own files — whose
 * folder is somewhere a filed note can stay: in user space, out of the Inbox
 * and the Archive (a project at `Archive.md` files into `Archive/`), and
 * within the walk's depth.
 */
export function filingRefusal({
  path,
  type,
}: {
  path: VaultPath;
  /** The note's `type:`, or null when it has none. */
  type: string | null;
}): string | null {
  if (isAtlasNote(path))
    return 'Notes are filed under a project or an area, not under Atlas’s own files.';
  if (isInInbox(path)) return 'That is still in the Inbox: process it first.';
  if (isArchivedPath(path)) return 'That is archived: unarchive it to file notes under it.';
  if (type === null) return 'Notes are filed under a project or an area, and that note is neither.';
  const wrongType = relationTypeRefusal({ def: FILED_UNDER, linkedType: type });
  if (wrongType !== null) return wrongType;
  return landingRefusal(joinVaultPath(filingFolder(path), 'filed.md'));
}

/** Why a note filed at `landing` would not stay filed, or null when it would. */
function landingRefusal(landing: VaultPath): string | null {
  if (isInInbox(landing))
    return 'Its folder is the Inbox: what is filed under it would still be waiting.';
  if (isArchivedPath(landing))
    return 'Its folder is the Archive: what is filed under it would be archived.';
  if (!isUserSpaceNote(landing)) return 'Its folder is one Atlas does not show.';
  // Its folder is one deeper than the note; past the walk's depth, what is filed would not be read.
  if (!isWithinWalk(landing)) {
    return 'It is too many folders deep: filed under it, notes would no longer be read.';
  }
  return null;
}

/**
 * The folder a project's notes are filed in: one named as the project,
 * beside its note — `Projects/Atlas.md` files into `Projects/Atlas/`. A
 * project already kept as a folder's own note, `Projects/Atlas/Atlas.md`,
 * files into that folder.
 */
export function filingFolder(project: VaultPath): VaultPath {
  const folder = parentVaultPath(project);
  const name = vaultPathName(project).replace(MARKDOWN, '');
  // Compared as the disk compares names: in any case, either Unicode composition.
  if (folder !== VAULT_ROOT && foldedVaultPath(vaultPathName(folder)) === foldedVaultPath(name)) {
    return folder;
  }
  return joinVaultPath(folder, name);
}

/**
 * Where an Inbox note goes when it is filed under `project`: in the project's
 * folder under its own name, numbered if that is taken. Only its name goes —
 * `Inbox/Meetings/Standup.md` lands as `Projects/Atlas/Standup.md`.
 */
export function processDestination({
  path,
  project,
  taken,
}: {
  path: VaultPath;
  project: VaultPath;
  taken: ReadonlySet<string>;
}): VaultPath {
  return freeNotePath(joinVaultPath(filingFolder(project), vaultPathName(path)), taken);
}

/**
 * What processing writes into a note: `project`, linking what it was filed
 * under, written the way every link in the app is — by name, or by path
 * where the name alone would open another note.
 */
export function filedUnderStamp({
  project,
  notePaths,
}: {
  project: VaultPath;
  notePaths: readonly VaultPath[];
}): Readonly<Record<string, string>> {
  return { [FILED_UNDER_KEY]: `[[${wikiLinkTargetFor(project, notePaths)}]]` };
}
