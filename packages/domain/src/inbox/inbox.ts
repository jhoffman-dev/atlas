import {
  freeNotePath,
  isArchivedPath,
  isPlaceOrNumbered,
  outsideArchiveSql,
} from '../archive/archive.ts';
import {
  GTD_STATUSES,
  gtdStatusOf,
  NEW_TASK_STATUS,
  TASK_KEYS,
  TASK_TYPE,
  type GtdStatus,
} from '../gtd/gtd-status.ts';
import { wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import {
  IMPORT_ERROR_KEY,
  IMPORT_OUTCOME_KEY,
  importStanding,
  type ImportOutcome,
} from '../meetings/meeting-arrival.ts';
import { PROPOSAL_TYPE } from '../proposals/proposal.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { waitingOnNames } from '../review/review-query.ts';
import { FILED_UNDER, FILED_UNDER_KEY } from '../types/para.ts';
import { relationTypeRefusal } from '../types/property-value.ts';
import {
  createVaultPath,
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

/** What a task waiting in the Inbox already says, which its row is clarified from (#112). */
export interface InboxTask {
  /** Its GTD status, or null when it has none or holds something else. */
  readonly status: GtdStatus | null;
  /** The project or area it is filed under, when its `project` links a note. */
  readonly project: VaultPath | null;
  /** The person its `waiting_on` links, when it links a note. */
  readonly waitingOn: VaultPath | null;
  /** Who it waits on as written — a linked name, or plain words; '' for nobody. */
  readonly waitingOnNames: string;
  /** `YYYY-MM-DD`, or null. */
  readonly defer: string | null;
  /** `YYYY-MM-DD`, or null. */
  readonly due: string | null;
}

/** A note waiting in the Inbox, as the Inbox lists it. */
export interface InboxItem {
  readonly path: VaultPath;
  readonly title: string;
  /** Its `type:`, or null for a plain note. */
  readonly type: string | null;
  /** The folder it arrived in under the Inbox — `Meetings` — or '' for the Inbox itself. */
  readonly arrivedIn: string;
  /**
   * Where a meeting file stands with the import (ADR-0027): its outcome once
   * stamped, `pending` while it waits in `Inbox/Meetings`, null for a note the
   * import never handles.
   */
  readonly importOutcome: ImportOutcome | 'pending' | null;
  /** Why the file failed the import, as written into it, or null. */
  readonly importError: string | null;
  /** What it holds as a task, or null for a note that is not one. */
  readonly task: InboxTask | null;
}

/**
 * How many wait in the one Inbox: the notes to file and the proposals to
 * answer, as the sidebar and the weekly review both count it. Null only while
 * neither has been read; one not read yet counts as none.
 */
export function inboxWaiting({
  toFile,
  toAnswer,
}: {
  toFile: number | null;
  toAnswer: number | null;
}): number | null {
  if (toFile === null && toAnswer === null) return null;
  return (toFile ?? 0) + (toAnswer ?? 0);
}

/** How many notes the Inbox lists at once. */
export const INBOX_LIST_LIMIT = 500;

/** What the Inbox's statement starts with, so a log or a stand-in index can tell it apart. */
export const INBOX_QUERY_MARK = '/* inbox */';

/** The columns {@link compileInboxQuery} comes back as, in order. */
export const INBOX_QUERY_COLUMNS = [
  'path',
  'title',
  'type',
  'importStamped',
  'importOutcome',
  'importError',
  'status',
  'project',
  'waitingOn',
  'waitingOnNames',
  'defer',
  'due',
] as const;

/*
 * Every subquery below finds a note's own rows by its path. `+p.key` keeps
 * the planner off the index on `key`: without statistics, which the index
 * never gathers, it would walk every note holding that key once per note
 * asked about — the whole vault, squared.
 */

/** A note's first value under `key`, as a column of the Inbox's statement. */
const firstValue = (key: string) =>
  `(SELECT p.value_text FROM props AS p WHERE p.path = files.path AND +p.key = '${key}' ORDER BY p.idx LIMIT 1)`;

/** The one value the note at `column` holds under `key`: null when it has none, or a list of several. */
const singleValue = (key: string, column = 'files.path') =>
  `(SELECT CASE WHEN count(*) = 1 THEN max(p.value_text) END FROM props AS p WHERE p.path = ${column} AND +p.key = '${key}')`;

/** A date property's first day, `YYYY-MM-DD`; null when it holds no date. */
const firstDay = (key: string) =>
  `(SELECT substr(p.value_date, 1, 10) FROM props AS p WHERE p.path = files.path AND +p.key = '${key}' AND p.value_date IS NOT NULL ORDER BY p.idx LIMIT 1)`;

/** The first note a relation under `key` links, by its path. */
const firstLinked = (key: string) =>
  `(SELECT r.dst FROM relations AS r WHERE r.src = files.path AND r.key = '${key}' AND r.dst IS NOT NULL ORDER BY r.idx LIMIT 1)`;

/** Every item under `key`, in order, joined as {@link waitingOnNames} splits them. */
const allItems = (key: string) =>
  `(SELECT group_concat(v, char(31)) FROM (SELECT coalesce(p.value_text, p.value_json) AS v FROM props AS p WHERE p.path = files.path AND +p.key = '${key}' ORDER BY p.idx))`;

/** Whether the note at `column` is of `type`, in any case and spacing. */
const isOfType = (column: string, type: string) =>
  `EXISTS (SELECT 1 FROM props AS p WHERE p.path = ${column} AND +p.key = 'type' AND lower(trim(p.value_text)) = '${type}')`;

const inInboxFolder = (column: string) =>
  `lower(substr(${column}, 1, ${INBOX_PREFIX.length})) = '${INBOX_PREFIX}'`;

/** The statuses a task has been clarified to: every GTD status but the Inbox's own. */
const CLARIFIED = GTD_STATUSES.filter((status) => status !== NEW_TASK_STATUS)
  .map((status) => `'${status}'`)
  .join(', ');

/** The note at `column` says no status at all: no item under `status` with anything in it. */
const noStatus = (column: string) =>
  `NOT EXISTS (SELECT 1 FROM props AS p WHERE p.path = ${column} AND +p.key = '${TASK_KEYS.status}' AND trim(coalesce(p.value_text, p.value_json, '')) <> '')`;

/** In use, and not already counted by the folder: outside `Inbox/` and the Archive. */
const elsewhere = (column: string) =>
  `NOT ${inInboxFolder(column)} AND ${outsideArchiveSql(column)}`;

/**
 * The paths that wait, as the arms of a UNION (#112), each starting from the
 * rows that can qualify so the statement costs what it lists, not what the
 * vault holds. Always: every note in the `Inbox` folder, and every task in
 * use whose status is Inbox wherever it lives — imported into `Tasks/`, say
 * — found from the `status` rows that say so. Once the vault's tasks start
 * in the Inbox (`tasksStartInInbox`), status is what says a task was
 * clarified: one in the folder that was given another GTD status has left,
 * with or without a project, and one outside it with no status at all — an
 * accepted proposal that named none — waits like any new task (ADR-0029:
 * none is Inbox). A vault still on statuses of its own keeps the folder
 * alone, since its captured tasks start at `backlog`, which is not a
 * decision there.
 */
function waitingArms(tasksStartInInbox: boolean): string[] {
  const clarified = `(${isOfType('f.path', TASK_TYPE)} AND coalesce(${singleValue(TASK_KEYS.status, 'f.path')}, '') IN (${CLARIFIED}))`;
  const inFolder = [
    `SELECT f.path FROM files AS f WHERE ${inInboxFolder('f.path')}`,
    ...(tasksStartInInbox ? [`  AND NOT ${clarified}`] : []),
  ].join('\n');
  const atInbox = [
    `SELECT s.path FROM props AS s WHERE s.key = '${TASK_KEYS.status}' AND s.value_text = '${NEW_TASK_STATUS}'`,
    `  AND ${elsewhere('s.path')}`,
    `  AND ${singleValue(TASK_KEYS.status, 's.path')} = '${NEW_TASK_STATUS}'`,
    `  AND ${isOfType('s.path', TASK_TYPE)}`,
  ].join('\n');
  const withNoStatus = [
    `SELECT ty.path FROM props AS ty WHERE ty.key = 'type' AND lower(trim(ty.value_text)) = '${TASK_TYPE}'`,
    `  AND ${elsewhere('ty.path')}`,
    `  AND ${noStatus('ty.path')}`,
  ].join('\n');
  return tasksStartInInbox ? [inFolder, atInbox, withNoStatus] : [inFolder, atInbox];
}

/** The notes that wait, in a statement's `FROM … WHERE`: no proposal, and only notes in user space. */
function waitingNotes(tasksStartInInbox: boolean): string[] {
  return [`WITH waiting(path) AS (`, waitingArms(tasksStartInInbox).join('\nUNION\n'), `)`];
}

const WAITING_FILES = [
  `FROM waiting JOIN files ON files.path = waiting.path`,
  `WHERE NOT ${isOfType('files.path', PROPOSAL_TYPE)}`,
  `  AND ${userSpaceNoteSql('files.path')}`,
];

/**
 * The Inbox's notes, asked of the index: newest first, so what just arrived
 * is on top, then by title so the list never reshuffles. Notes of the
 * proposal type are left out, wherever in the Inbox they are — they are
 * answered in its Proposals section, never filed — and any other note is
 * listed, one dropped into `Inbox/Proposals` included. Each note carries
 * what the meeting import wrote into it, and what it says as a task. Which
 * notes wait is {@link waitingArms}' rule. A page at a time: `limit` from
 * `offset` (#167).
 */
export function compileInboxQuery({
  limit = INBOX_LIST_LIMIT,
  offset = 0,
  tasksStartInInbox = false,
}: {
  limit?: number;
  /** How many of the newest to pass over: where this page starts. */
  offset?: number;
  /** Whether the vault's Task type has the Inbox status (`tasksStartInInbox`). */
  tasksStartInInbox?: boolean;
} = {}): CompiledQuery {
  return {
    sql: [
      `${INBOX_QUERY_MARK} ${waitingNotes(tasksStartInInbox).join('\n')}`,
      `SELECT files.path AS "path", files.title AS "title",`,
      `  ${firstValue('type')} AS "type",`,
      // A stamp with its value cleared is a stamp still, as the import reads it.
      `  EXISTS (SELECT 1 FROM props AS p WHERE p.path = files.path AND +p.key = '${IMPORT_OUTCOME_KEY}') AS "importStamped",`,
      `  ${firstValue(IMPORT_OUTCOME_KEY)} AS "importOutcome",`,
      `  ${firstValue(IMPORT_ERROR_KEY)} AS "importError",`,
      `  ${singleValue(TASK_KEYS.status)} AS "status",`,
      `  ${firstLinked(FILED_UNDER_KEY)} AS "project",`,
      `  ${firstLinked(TASK_KEYS.waitingOn)} AS "waitingOn",`,
      `  ${allItems(TASK_KEYS.waitingOn)} AS "waitingOnNames",`,
      `  ${firstDay(TASK_KEYS.defer)} AS "defer",`,
      `  ${firstDay(TASK_KEYS.due)} AS "due"`,
      ...WAITING_FILES,
      `ORDER BY files.modified DESC, lower(files.title), files.path`,
      `LIMIT ? OFFSET ?`,
    ].join('\n'),
    parameters: [Math.max(1, Math.floor(limit)), Math.max(0, Math.floor(offset))],
  };
}

/** How many notes wait in the Inbox, as {@link compileInboxQuery} would list them all (#167). */
export function compileInboxCountQuery({
  tasksStartInInbox = false,
}: {
  tasksStartInInbox?: boolean;
} = {}): CompiledQuery {
  return {
    sql: [
      `${INBOX_QUERY_MARK} ${waitingNotes(tasksStartInInbox).join('\n')}`,
      `SELECT count(*) AS "total"`,
      ...WAITING_FILES,
    ].join('\n'),
    parameters: [],
  };
}

/** A row of {@link compileInboxQuery}, as the Inbox lists it. */
export function inboxItem(row: {
  path: VaultPath;
  title: string;
  type: unknown;
  /** Whether the note carries `atlas_import_outcome` at all, cleared or not. */
  importStamped?: boolean;
  importOutcome?: unknown;
  importError?: unknown;
  status?: unknown;
  project?: unknown;
  waitingOn?: unknown;
  waitingOnNames?: unknown;
  defer?: unknown;
  due?: unknown;
}): InboxItem {
  const { path, importStamped = false, importOutcome = null } = row;
  const type = textOrNull(row.type);
  // In the Inbox folder, the folder it arrived in; a task living elsewhere arrived in none.
  const within = isInInbox(path) ? parentVaultPath(path).split('/').slice(1).join('/') : '';
  return {
    path,
    title: row.title,
    type,
    arrivedIn: within,
    importOutcome: importStanding({ path, stamped: importStamped, stamp: importOutcome }),
    importError: textOrNull(row.importError),
    task: type?.toLowerCase() === TASK_TYPE ? inboxTask(row) : null,
  };
}

function inboxTask(row: {
  status?: unknown;
  project?: unknown;
  waitingOn?: unknown;
  waitingOnNames?: unknown;
  defer?: unknown;
  due?: unknown;
}): InboxTask {
  return {
    status: gtdStatusOf(row.status),
    project: pathOrNull(row.project),
    waitingOn: pathOrNull(row.waitingOn),
    waitingOnNames: waitingOnNames(row.waitingOnNames),
    defer: textOrNull(row.defer),
    due: textOrNull(row.due),
  };
}

const pathOrNull = (value: unknown): VaultPath | null => {
  const text = textOrNull(value);
  return text === null ? null : createVaultPath(text);
};

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * Whether a note going from `from` to `to` is Process filing it: out of the
 * Inbox into a folder outside the Inbox and the Archive, under its own name
 * — numbered if that was taken — as {@link processDestination} puts it. Its
 * bytes differ, since Process stamps `project`, so the feed cannot pair the
 * two ends by them.
 */
export function isProcessMove(from: VaultPath, to: VaultPath): boolean {
  if (!isInInbox(from) || isInInbox(to) || isArchivedPath(to)) return false;
  return isPlaceOrNumbered(to, joinVaultPath(parentVaultPath(to), vaultPathName(from)));
}

/**
 * Why a note cannot be processed out of the Inbox, or null when it can. A
 * proposal — by its type, wherever it sits — is answered, never filed.
 */
export function processRefusal({
  path,
  type,
}: {
  path: VaultPath;
  /** The note's `type:`, or null when it has none or cannot be read. */
  type: string | null;
}): string | null {
  if (!isInInbox(path)) return 'It is not in the Inbox.';
  if (type?.trim().toLowerCase() === PROPOSAL_TYPE) {
    return 'A proposal is answered, not filed: accept or reject it.';
  }
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
