import { isArchivedPath } from '../archive/archive.ts';
import type { NoteChange } from '../index/note-changes.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import type { MeetingImportError } from './meeting-import-error.ts';

/**
 * Where meeting files landed before each had a folder for its month
 * (ADR-0027, #214). An older mapping still writes here, so it is still a
 * place meeting files land, and every file in it is the import's to judge.
 */
export const MEETING_INBOX = 'Inbox/Meetings';

/**
 * Where the meeting import writes each meeting now, in a folder for its
 * month — `Meetings/2026/10` — and the Meeting type's home (#214). A note
 * made here by hand is a meeting like any other: only a file that declares
 * the contract ({@link IMPORT_CONTRACT_KEY}) is the import's.
 */
export const MEETINGS_HOME = 'Meetings';

const MEETING_INBOX_PREFIX = `${MEETING_INBOX.toLowerCase()}/`;

/** A month's folder under `Meetings`, `meetings/2026/10/`, as the start of a lower-cased path. */
const MONTH_FOLDER = new RegExp(`^${MEETINGS_HOME.toLowerCase()}/\\d{4}/\\d{2}/`);
/** {@link MONTH_FOLDER} as a SQLite GLOB over a lower-cased path. */
const MONTH_FOLDER_GLOB = `${MEETINGS_HOME.toLowerCase()}/[0-9][0-9][0-9][0-9]/[0-9][0-9]/*`;

/** The key a meeting file names the contract it follows by: `atlas_import: meeting/v1`. */
export const IMPORT_CONTRACT_KEY = 'atlas_import';

/**
 * What the import wrote into a file it handled: the one line that says it is
 * done with it. `atlas_import` already names the contract a file follows
 * (`meeting/v1`), so the outcome has a key of its own.
 */
export const IMPORT_OUTCOME_KEY = 'atlas_import_outcome';

/** How the import settled a file: let in, archived as a copy, or refused. */
export const IMPORT_OUTCOMES = ['imported', 'duplicate', 'error'] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

/** What DFAI writes into a meeting file that breaks the contract: why, in one line. */
export const IMPORT_ERROR_KEY = 'atlas_import_error';

/** What DFAI writes into a second copy of a meeting: a link to the first. */
export const DUPLICATE_OF_KEY = 'atlas_duplicate_of';

/**
 * Whether a note sits where meeting files land — a month's folder under
 * `Meetings`, `Meetings/2026/10/`, or anywhere in the older `Inbox/Meetings`
 * — and not in the Archive; the disk does not tell case apart. A folder of
 * meetings filed some other way, `Meetings/From Notion`, is not one. Whether
 * a note there is the import's is {@link isMeetingArrival}'s to say.
 */
export function isMeetingInboxPath(path: string): boolean {
  if (isArchivedPath(path)) return false;
  const folded = path.toLowerCase();
  return folded.startsWith(MEETING_INBOX_PREFIX) || MONTH_FOLDER.test(folded);
}

/** {@link isMeetingInboxPath}'s folders as a SQL condition on a path column, Archive aside. */
export function meetingLandingSql(column: string): string {
  return `(lower(${column}) LIKE '${MEETING_INBOX_PREFIX}%' OR lower(${column}) GLOB '${MONTH_FOLDER_GLOB}')`;
}

/** Whether a note sits in the older `Inbox/Meetings`, where every file is the import's. */
export function isInMeetingInboxFolder(path: string): boolean {
  return path.toLowerCase().startsWith(MEETING_INBOX_PREFIX) && !isArchivedPath(path);
}

/** Whether a note's frontmatter names a contract it follows: an `atlas_import` with something in it. */
export function declaresImport(properties: Readonly<Record<string, unknown>>): boolean {
  const declared = properties[IMPORT_CONTRACT_KEY];
  return declared !== undefined && declared !== null && String(declared).trim() !== '';
}

/** What says whether a note is the meeting import's: where it is, and what its frontmatter says. */
export interface ArrivalSigns {
  readonly path: string;
  /** It declares the contract (`atlas_import`). */
  readonly importDeclared?: boolean | undefined;
  /** How the import settled it, when it says. */
  readonly importOutcome?: ImportOutcome | string | null | undefined;
}

/**
 * Whether a note is the meeting import's to settle (#214): a file where
 * meeting files land that declares the contract, or that the import already
 * stamped — and, in the older `Inbox/Meetings`, any file at all, as before.
 * A meeting made by hand in `Meetings` declares nothing and is a note like
 * any other, in play from the moment it is made.
 */
export function isMeetingArrival({ path, importDeclared, importOutcome }: ArrivalSigns): boolean {
  if (!isMeetingInboxPath(path)) return false;
  if (isInMeetingInboxFolder(path)) return true;
  return importDeclared === true || (importOutcome !== undefined && importOutcome !== null);
}

/**
 * How the import settled a file, from its frontmatter: null when it has not
 * — an arrival not finished yet, or a stamp holding no value at all (`[]`). A
 * list is read by its first item and a name without the spaces round it; a
 * stamp it does not know is a stamp all the same, kept as `imported`: the file
 * is someone's, and is left alone. This is the one reader of a stamp: the
 * index's rows and the file's frontmatter both go through it, so they never
 * disagree on what a stamp says.
 */
export function importOutcomeOf(
  properties: Readonly<Record<string, unknown>>,
): ImportOutcome | null {
  if (!Object.hasOwn(properties, IMPORT_OUTCOME_KEY)) return null;
  const stamp = properties[IMPORT_OUTCOME_KEY];
  const said = Array.isArray(stamp) ? (stamp[0] as unknown) : stamp;
  if (Array.isArray(stamp) && stamp.length === 0) return null;
  const name = typeof said === 'string' ? said.trim() : said;
  return IMPORT_OUTCOMES.includes(name as ImportOutcome) ? (name as ImportOutcome) : 'imported';
}

/**
 * Whether a note is in play to what reacts to notes: any note that is not
 * the meeting import's, always; one that is, once the import has let it in
 * (#92, {@link isMeetingArrival}).
 */
export function isInPlay(
  note: ArrivalSigns & { importOutcome: ImportOutcome | null | undefined },
): boolean {
  return !isMeetingArrival(note) || note.importOutcome === 'imported';
}

/**
 * Where a meeting file stands with the import, as a listing says it: its
 * outcome when it is stamped — read as the import reads it, a cleared one as
 * `imported` — `pending` when it is the import's and not settled yet, and
 * null when it was never the import's (a meeting filed before DFAI
 * imported, or made by hand).
 */
export function importStanding({
  path,
  stamped,
  stamp,
  declared = false,
}: {
  path: string;
  stamped: boolean;
  stamp: unknown;
  /** It declares the contract (`atlas_import`). */
  declared?: boolean;
}): ImportOutcome | 'pending' | null {
  if (stamped) return importOutcomeOf({ [IMPORT_OUTCOME_KEY]: stamp });
  return isMeetingArrival({ path, importDeclared: declared }) ? 'pending' : null;
}

/**
 * The notes one sync's changes give the meeting import to look at: each
 * added or changed that is the import's ({@link isMeetingArrival}), once, in
 * the order reported.
 * The feed only says where to look — what a file is due comes from its own
 * stamp, so a move, a rename or an unarchive needs no pairing here.
 *
 * This is deliberately wider than the feed's arrival rule (`arrivedPaths`),
 * which drops a note filed, renamed or edited in place: an unstamped file
 * moved within `Inbox/Meetings` is still unfinished, and one marked `error`
 * is checked again when it is edited. A note made where another left (a
 * `changed` entry carrying `before`) is looked at like any other.
 */
export function meetingCandidates(changes: readonly NoteChange[]): string[] {
  const paths = changes
    .filter((change) => change.kind !== 'removed' && isMeetingArrival(change))
    .map((change) => change.path);
  return [...new Set(paths)];
}

/** How many problems the error line names before it says how many more there are. */
const ERRORS_NAMED = 3;

/**
 * Why a meeting file broke the contract, as the one line written into it
 * under {@link IMPORT_ERROR_KEY}: the first few problems, and how many more
 * there are. A problem in the body says its section and its line; a key's
 * problem names the key already. The full list is what the contract's
 * validator prints (`tools/n8n/validate-meeting.mjs`).
 */
export function importErrorText(errors: readonly MeetingImportError[]): string {
  if (errors.length === 0) return 'It does not follow meeting/v1.';
  const named = errors.slice(0, ERRORS_NAMED).map(errorLine);
  const more = errors.length - named.length;
  return [...named, ...(more > 0 ? [`and ${more} more`] : [])].join('; ');
}

const SAYS_ITS_LINE = /\bline \d+/i;

function errorLine(error: MeetingImportError): string {
  const message = error.message.replace(/\s+/g, ' ').trim();
  if (error.in === 'frontmatter') return message;
  const placed =
    error.line === null || SAYS_ITS_LINE.test(message) ? message : `line ${error.line}: ${message}`;
  return `${error.field}: ${placed}`;
}

/** A meeting's holders, as the import settles them: the one kept, and the copies to archive. */
export interface MeetingCopies {
  readonly original: string;
  /** Every other holder not yet settled, where meeting files land: each is marked and archived. */
  readonly copies: readonly string[];
}

/**
 * Which of the notes holding one meeting's provider + external_id is the
 * meeting, and which are copies of it (ADR-0027) — decided by what the
 * files say and where they are, never by which was heard of first, so two
 * Macs looking at the same files keep the same one.
 *
 * `holders` are the notes that hold the id now and follow the contract,
 * not marked as a copy or as failing import; `imported` are those of them
 * the import has already let in. The original is the first in this order:
 *
 * 1. one already imported — once let in, a meeting stays the meeting;
 * 2. one filed somewhere else in the vault;
 * 3. one in the Archive;
 * 4. one where meeting files land;
 *
 * and, among equals, the first by its path compared without case, Unicode
 * composition or extension — so a name sorts before its longer variants: the
 * mapping's `<date> <title>` before `<date> <title> 2`, a sync conflict's
 * `(conflict from …)` copy, and the mapping's `(<provider> <hash>)` path. The
 * copies are the other holders where meeting files land that are not yet
 * imported; one filed, archived or imported is left as it is.
 */
export function meetingCopies(
  holders: readonly string[],
  imported: readonly string[] = [],
): MeetingCopies {
  const settled = new Set(imported);
  const rank = (path: string) => (settled.has(path) ? 0 : 1 + placeRank(path));
  const ranked = [...new Set([...holders, ...imported])].sort(
    (a, b) => rank(a) - rank(b) || byFoldedName(a, b),
  );
  const [original] = ranked;
  if (original === undefined) throw new Error('A meeting with no holder has no original.');
  const copies = ranked.slice(1).filter((path) => isMeetingInboxPath(path) && !settled.has(path));
  return { original, copies };
}

function placeRank(path: string): number {
  if (isMeetingInboxPath(path)) return 2;
  return isArchivedPath(path) ? 1 : 0;
}

const EXTENSION = /\.(md|markdown)$/;

/** A path as two Macs both spell it: composed, in lower case, without its extension. */
const foldedName = (path: string) => foldedVaultPath(path).replace(EXTENSION, '');

function byFoldedName(a: string, b: string): number {
  const [left, right] = [foldedName(a), foldedName(b)];
  if (left !== right) return left < right ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
