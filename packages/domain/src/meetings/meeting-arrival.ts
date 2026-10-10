import { isArchivedPath } from '../archive/archive.ts';
import type { NoteChange } from '../index/note-changes.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import type { MeetingImportError } from './meeting-import-error.ts';

/**
 * Where the meeting import contract puts each meeting file (ADR-0027): the
 * mapping commits it here, and a pull brings it in.
 */
export const MEETING_INBOX = 'Inbox/Meetings';

const MEETING_INBOX_PREFIX = `${MEETING_INBOX.toLowerCase()}/`;

/**
 * What the import wrote into a file it handled: the one line that says it is
 * done with it. `atlas_import` already names the contract a file follows
 * (`meeting/v1`), so the outcome has a key of its own.
 */
export const IMPORT_OUTCOME_KEY = 'atlas_import_outcome';

/** How the import settled a file: let in, archived as a copy, or refused. */
export const IMPORT_OUTCOMES = ['imported', 'duplicate', 'error'] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

/** What Atlas writes into a meeting file that breaks the contract: why, in one line. */
export const IMPORT_ERROR_KEY = 'atlas_import_error';

/** What Atlas writes into a second copy of a meeting: a link to the first. */
export const DUPLICATE_OF_KEY = 'atlas_duplicate_of';

/** Whether a note sits where meeting files land, at any depth; the disk does not tell case apart. */
export function isMeetingInboxPath(path: string): boolean {
  return path.toLowerCase().startsWith(MEETING_INBOX_PREFIX) && !isArchivedPath(path);
}

/**
 * How the import settled a file, from its frontmatter: null when it has not
 * — an arrival not finished yet. A stamp it does not know is a stamp all the
 * same, kept as `imported`: the file is someone's, and is left alone.
 */
export function importOutcomeOf(
  properties: Readonly<Record<string, unknown>>,
): ImportOutcome | null {
  if (!Object.hasOwn(properties, IMPORT_OUTCOME_KEY)) return null;
  const said = properties[IMPORT_OUTCOME_KEY];
  return IMPORT_OUTCOMES.includes(said as ImportOutcome) ? (said as ImportOutcome) : 'imported';
}

/**
 * Where a meeting file stands with the import, as a listing says it: its
 * outcome when it is stamped — read as the import reads it, a cleared one as
 * `imported` — `pending` when it waits where meeting files land, and null
 * when it is elsewhere and was never the import's (a meeting filed before
 * Atlas imported, or made by hand).
 */
export function importStanding({
  path,
  stamped,
  stamp,
}: {
  path: string;
  stamped: boolean;
  stamp: unknown;
}): ImportOutcome | 'pending' | null {
  if (stamped) return importOutcomeOf({ [IMPORT_OUTCOME_KEY]: stamp });
  return isMeetingInboxPath(path) ? 'pending' : null;
}

/**
 * The notes one sync's changes give the meeting import to look at: each
 * added or changed where meeting files land, once, in the order reported.
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
    .filter((change) => change.kind !== 'removed' && isMeetingInboxPath(change.path))
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
