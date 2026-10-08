import { isArchivedPath, originOf } from '../archive/archive.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import type { NoteChange } from '../index/note-changes.ts';
import type { MeetingImportError } from './meeting-import-error.ts';

/**
 * Where the meeting import contract puts each meeting file (ADR-0027): the
 * mapping commits it here, and a pull brings it in.
 */
export const MEETING_INBOX = 'Inbox/Meetings';

const MEETING_INBOX_PREFIX = `${MEETING_INBOX.toLowerCase()}/`;

/** What Atlas writes into a meeting file that breaks the contract: why, in one line. */
export const IMPORT_ERROR_KEY = 'atlas_import_error';

/** What Atlas writes into a second copy of a meeting: a link to the first. */
export const DUPLICATE_OF_KEY = 'atlas_duplicate_of';

/** Whether a note sits where meeting files land, at any depth; the disk does not tell case apart. */
export function isMeetingInboxPath(path: string): boolean {
  return path.toLowerCase().startsWith(MEETING_INBOX_PREFIX) && !isArchivedPath(path);
}

/**
 * A note the meeting import looks at: one that `arrived` where meeting files
 * land, or one there that `changed`. Both are read and judged by what the
 * file says; the kind only decides whether a file that breaks the contract
 * and carries no mark is marked (an arrival) or left alone (an edit).
 */
export interface MeetingCandidate {
  readonly path: string;
  /** The version the change feed reported: what makes a change heard twice the same change. */
  readonly digest: string;
  readonly kind: 'arrived' | 'changed';
}

/**
 * The notes one sync's changes give the meeting import, in the order the
 * feed reported them: each added or changed note where meeting files land.
 *
 * A note added there is no arrival when the same sync took away a note it
 * came from — a note with the same bytes (a move or a rename, which the feed
 * does not pair) or the archived note it was restored from (unarchiving, which
 * also takes the archive stamp out, so the bytes differ). Filing a meeting,
 * renaming it in place and bringing it back from the Archive are none of them
 * its arrival.
 */
export function meetingCandidates(changes: readonly NoteChange[]): MeetingCandidate[] {
  const removed = changes.filter((change) => change.kind === 'removed');
  const movedAway = new Set(removed.map((change) => change.digest));
  const restorable = new Set(removed.filter(isArchived).map(restoredPlace));
  return changes.flatMap((change): MeetingCandidate[] => {
    if (!isMeetingInboxPath(change.path)) return [];
    if (change.kind === 'changed') return [candidate(change, 'changed')];
    if (change.kind !== 'added' || movedAway.has(change.digest)) return [];
    if (restorable.has(restoredPlace(change))) return [];
    return [candidate(change, 'arrived')];
  });
}

const candidate = (change: NoteChange, kind: MeetingCandidate['kind']): MeetingCandidate => ({
  path: change.path,
  digest: change.digest,
  kind,
});

const isArchived = (change: NoteChange) => isArchivedPath(change.path);

/** A number unarchiving gives a name when its place is taken: `Standup 2.md`. */
const RESTORE_NUMBER = / \d+(\.(?:md|markdown))$/i;

/**
 * Where a note is, or was before the Archive, as unarchiving compares places:
 * without `Archive/`, without the number a taken name was given, in any case.
 */
function restoredPlace(change: NoteChange): string {
  const origin = originOf(createVaultPath(change.path), null);
  return foldedVaultPath(origin.replace(RESTORE_NUMBER, '$1'));
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
  /** Every other holder that sits where meeting files land: each is marked and archived. */
  readonly copies: readonly string[];
}

/**
 * Which of the notes holding one meeting's provider + external_id is the
 * meeting, and which are copies of it (ADR-0027) — decided by where each one
 * is, never by which was heard of first, so two Macs that hear the same files
 * in different syncs, or listed in another order, keep the same one.
 *
 * `holders` are the notes that hold the id as they are now and follow the
 * contract, not marked as a copy or as failing import. The original is the
 * first of them in this order:
 *
 * 1. a meeting filed somewhere else in the vault — it was there, and settled;
 * 2. one in the Archive — filed away, and still the same meeting;
 * 3. one where meeting files land, at the path the mapping writes first
 *    (`<date> <title>.md`);
 * 4. one there at the path it writes when that is taken by another meeting
 *    (`<date> <title> (<provider> <8 hex>).md`);
 *
 * and, among equals, the first by path. The copies are the other holders
 * where meeting files land; one filed or archived elsewhere is left as it is.
 */
export function meetingCopies(holders: readonly string[]): MeetingCopies {
  const ranked = [...new Set(holders)].sort(byPlaceThenPath);
  const [original] = ranked;
  if (original === undefined) throw new Error('A meeting with no holder has no original.');
  return { original, copies: ranked.slice(1).filter(isMeetingInboxPath) };
}

/** The path the mapping writes when the first is taken: ` (<provider> <8 hex>)` before `.md`. */
const COLLISION_PATH = / \([a-z][a-z0-9-]* [0-9a-f]{8}\)\.md$/i;

function placeRank(path: string): number {
  if (isMeetingInboxPath(path)) return COLLISION_PATH.test(path) ? 3 : 2;
  return isArchivedPath(path) ? 1 : 0;
}

function byPlaceThenPath(a: string, b: string): number {
  const rank = placeRank(a) - placeRank(b);
  if (rank !== 0) return rank;
  return a < b ? -1 : a > b ? 1 : 0;
}
