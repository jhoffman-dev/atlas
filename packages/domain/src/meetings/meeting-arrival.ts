import { isArchivedPath } from '../archive/archive.ts';
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
 * land, or one there that `changed` — which is looked at again only when it
 * carries an import error, so a fix clears it.
 */
export interface MeetingCandidate {
  readonly path: string;
  /** The version the change feed reported, so a file changed since is left for the next sync. */
  readonly digest: string;
  readonly kind: 'arrived' | 'changed';
}

/**
 * The notes one sync's changes give the meeting import, in the order the
 * feed reported them.
 *
 * A note added where meeting files land has arrived — unless a note with the
 * same bytes went in the same sync, which makes it a move or a rename (the
 * feed pairs nothing; this does, by digest). Filing a meeting is not its
 * arrival, nor is renaming it in place.
 */
export function meetingCandidates(changes: readonly NoteChange[]): MeetingCandidate[] {
  const movedAway = new Set(
    changes.filter((change) => change.kind === 'removed').map((change) => change.digest),
  );
  return changes.flatMap((change): MeetingCandidate[] => {
    if (!isMeetingInboxPath(change.path)) return [];
    if (change.kind === 'changed') return [candidate(change, 'changed')];
    if (change.kind === 'added' && !movedAway.has(change.digest)) {
      return [candidate(change, 'arrived')];
    }
    return [];
  });
}

const candidate = (change: NoteChange, kind: MeetingCandidate['kind']): MeetingCandidate => ({
  path: change.path,
  digest: change.digest,
  kind,
});

/** How many problems the error line names before it says how many more there are. */
const ERRORS_NAMED = 3;

/**
 * Why a meeting file broke the contract, as the one line written into it
 * under {@link IMPORT_ERROR_KEY}: the first few problems, each with its line
 * when it has one, and how many more there are. The full list is what the
 * contract's validator prints (`tools/n8n/validate-meeting.mjs`).
 */
export function importErrorText(errors: readonly MeetingImportError[]): string {
  if (errors.length === 0) return 'It does not follow meeting/v1.';
  const named = errors.slice(0, ERRORS_NAMED).map(errorLine);
  const more = errors.length - named.length;
  return [...named, ...(more > 0 ? [`and ${more} more`] : [])].join('; ');
}

function errorLine(error: MeetingImportError): string {
  const message = error.message.replace(/\s+/g, ' ').trim();
  return error.line === null ? message : `line ${error.line}: ${message}`;
}

/** Whether a meeting is the first of its kind in the vault, or a copy of one there already. */
export type DuplicateDecision =
  { readonly kind: 'original' } | { readonly kind: 'duplicate'; readonly of: string };

/**
 * Whether the meeting at `path` is a second copy (ADR-0027): another note
 * holds the same provider + external_id and was there first.
 *
 * `holders` are the notes that hold that id as they are now — not ones
 * marked as a duplicate or as failing import — and may include `path` itself. `pending`
 * are the notes arriving in the same sync that have not been decided yet: of
 * two copies that arrive together, the first decided is the original and the
 * second its duplicate, so neither is mistaken for the other's copy. A holder
 * outside the Archive is preferred as the original, then the first by path,
 * so the same vault always gets the same answer.
 */
export function duplicateDecision({
  path,
  holders,
  pending,
}: {
  path: string;
  holders: readonly string[];
  pending: ReadonlySet<string>;
}): DuplicateDecision {
  const settled = holders
    .filter((holder) => holder !== path && !pending.has(holder))
    .sort(byArchiveThenPath);
  const [original] = settled;
  return original === undefined ? { kind: 'original' } : { kind: 'duplicate', of: original };
}

function byArchiveThenPath(a: string, b: string): number {
  const archived = Number(isArchivedPath(a)) - Number(isArchivedPath(b));
  if (archived !== 0) return archived;
  return a < b ? -1 : a > b ? 1 : 0;
}
