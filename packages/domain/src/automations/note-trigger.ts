/**
 * An automation that runs when a note of a type appears or changes (P29-01,
 * ADR-0028), rather than on a clock. Its file says so in words:
 *
 * ```yaml
 * when: a meeting is created or changed
 * which: FROM meeting WHERE kind = standup
 * ```
 *
 * The type is the trigger's, and the query is its "where": the rule acts on a
 * note the change feed reported only if its query matches that note too.
 *
 * It runs once per version of a note: what it handled — the version that set
 * it off, and the version its own write left — is written in its log, and a
 * version already there never sets it off again. A restart, a full re-index
 * or a second pull of the same bytes does not run it twice.
 */

import { isArchivedPath } from '../archive/archive.ts';
import { arrivedPaths, unpairedChanges, type NoteChange } from '../index/note-changes.ts';
import { isMeetingArrival } from '../meetings/meeting-arrival.ts';
import { parseAtlasQuery } from '../query-language/parse.ts';
import { QueryTextError } from '../query-language/query-text-error.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { isSchemaKey, ledgerNow, type HandledLedger } from './handled-ledger.ts';
import { MAX_LOG_ENTRIES, type LogEntry } from './run-log.ts';

/** What happening to a note sets the rule off. */
export type NoteEvent = 'created' | 'changed';

export interface NoteTrigger {
  readonly kind: 'note';
  /** The type a note must be, as its frontmatter writes it. */
  readonly type: string;
  /** At least one, `created` first. */
  readonly on: readonly NoteEvent[];
}

/** One version of one note: its path, and the digest of its bytes as the index read them. */
export interface NoteVersionRef {
  readonly path: VaultPath;
  readonly digest: string;
  /**
   * Further keys a rule's schema knows this version by, beside the whole-file
   * digest. A handled version is recognised by any of them, wherever it is
   * and whatever else changed, so a key must be unique to the thing answered:
   * it MUST include the note's identity, as
   * `meeting:<provider>:<external_id>:transcript:<digest>` does, and never be a
   * bare digest, which two notes can share. A key that is empty or has
   * no `:` with something on each side is ignored (`isSchemaKey`).
   */
  readonly keys?: readonly string[];
}

const TYPE_NAME = '[A-Za-z_][A-Za-z0-9_]*';
const NOTE_TRIGGER = new RegExp(
  `^an? (${TYPE_NAME}) is (created|changed|created or changed|changed or created)$`,
  'i',
);

/** Reads `a meeting is created`, `… is changed` or `… is created or changed`; null when it is none. */
export function parseNoteTrigger(text: string): NoteTrigger | null {
  const match = NOTE_TRIGGER.exec(text.trim().replace(/\s+/g, ' '));
  if (match === null) return null;
  const events = match[2]!.toLowerCase();
  const on = (['created', 'changed'] as const).filter((event) => events.includes(event));
  return { kind: 'note', type: match[1]!, on };
}

/** The trigger as the rule's file writes it, which {@link parseNoteTrigger} reads back. */
export function printNoteTrigger(trigger: NoteTrigger): string {
  const article = /^[aeiou]/i.test(trigger.type) ? 'an' : 'a';
  return `${article} ${trigger.type} is ${trigger.on.join(' or ')}`;
}

/** Why a note trigger's query cannot be its "where", or null: it must take that type's notes. */
export function noteTriggerQueryProblem(trigger: NoteTrigger, which: string): string | null {
  let from: readonly string[];
  try {
    from = parseAtlasQuery(which).from.map((name) => name.text);
  } catch (cause) {
    // A query that does not read is refused where every rule's is: when it is run or dry-run.
    if (cause instanceof QueryTextError) return null;
    throw cause;
  }
  if (from.includes(trigger.type)) return null;
  return `A rule that runs when ${printNoteTrigger(trigger)} takes its notes FROM ${trigger.type}.`;
}

/**
 * The versions in one sync's changes that set the trigger off, in the order
 * the feed reported them: notes of its type that arrived — added and not one
 * end of a move, or made at a path the note there left in the same sync — or
 * whose bytes changed. A note in the Archive is out of play, as every query
 * leaves it out; archiving a note is not its arrival.
 *
 * Where meeting files land, a note is the meeting import's until it lets it
 * in (#92): see {@link eventWhereMeetingsLand}.
 */
export function triggeringVersions(
  trigger: NoteTrigger,
  changes: readonly NoteChange[],
): NoteVersionRef[] {
  const arrived = arrivedPaths(changes);
  const hears = (change: NoteChange): boolean => {
    const event = noteEventOf(change, arrived);
    return event !== null && trigger.on.includes(event);
  };
  return changes
    .filter(
      (change) => change.type === trigger.type && !isArchivedPath(change.path) && hears(change),
    )
    .map((change) => ({ path: createVaultPath(change.path), digest: change.digest }));
}

/** What a change is to a rule a note sets off, given the paths new notes arrived at; null when nothing. */
function noteEventOf(change: NoteChange, arrived: ReadonlySet<string>): NoteEvent | null {
  if (change.kind === 'removed') return null;
  if (isMeetingArrival(change)) return eventWhereMeetingsLand(change);
  if (arrived.has(change.path)) return 'created';
  return change.kind === 'changed' ? 'changed' : null;
}

/**
 * Where meeting files land, a note is not yet a note to a rule: the import
 * has still to let it in, or has refused it, or archives it as a copy. Its
 * arrival is the version the import let in — the one that first carries
 * `imported` — so a rule runs once a meeting is in, and never on one refused;
 * the import's own stamp is not a change to the note, nor is any write before
 * it. A file added already stamped is not the import's work (a copy sync
 * made, a meeting moved or put back), and one whose arrival was heard already
 * — it is moved in, or its lost stamp restored — is not heard twice.
 */
function eventWhereMeetingsLand(change: NoteChange): NoteEvent | null {
  if (change.importOutcome !== 'imported' || change.kind !== 'changed') return null;
  if (change.beforeImportOutcome === 'imported') return 'changed';
  return change.beforeArrivalHeard === true ? null : 'created';
}

/**
 * Whether one sync's changes are news to the trigger: a note of its type set
 * it off, or one left its path — which may end what it remembers of it.
 */
export function noteTriggerHears(trigger: NoteTrigger, changes: readonly NoteChange[]): boolean {
  if (triggeringVersions(trigger, changes).length > 0) return true;
  const { left } = unpairedChanges(changes);
  return changes.some((change) => change.type === trigger.type && left.has(change.path));
}

/** What a rule has handled: each version of each note, by path. */
export interface HandledVersions {
  /** Whether it handled this version of this note, or its own write left it. */
  readonly has: (version: NoteVersionRef) => boolean;
  /** Whether it handled this very version at this very path (not words answered, nor another note's). */
  readonly hasHere: (version: NoteVersionRef) => boolean;
  /** Whether it handled any version of the note at this path. */
  readonly hasPath: (path: string) => boolean;
  /**
   * Milliseconds before which this memory is incomplete (the ledger had to
   * forget); a note last written then cannot be vouched for. Null when it
   * forgot nothing.
   */
  readonly vouchesFrom: number | null;
}

/** What a rule is asked to know about the notes as they are now, to tell one note from another with the same bytes. */
export interface HandledContext {
  /** The ledger the rule's log holds; null for a log from before it, which the entries then build. */
  readonly ledger?: HandledLedger | null;
  /**
   * The digest the note at a path holds now, or undefined when none does.
   * Words answered at a path that still holds them are that note's alone;
   * without this view every path is taken to have left.
   */
  readonly holds?: (path: string) => string | undefined;
}

/**
 * Every version a rule's log says it handled, or left by its own write —
 * read from the handled ledger (which outlives the log's entries) with the
 * entries it has not folded in laid over it, oldest first — runs an Atlas
 * that did not know the ledger appended — so a path a note has left since has
 * no history: a new note there is new to the rule. A note left a path when
 * the log says it `went` — deleted, moved, renamed or archived by someone
 * else, or replaced — or when the run itself archived it.
 *
 * What a Claude step answered is remembered by its words (P29-03: "a model
 * is not asked twice for the same words"): the digest of a version a run
 * asked Claude about is handled at whatever path those bytes are now, so a
 * meeting filed or renamed out of the Inbox, unchanged, is not asked about
 * again. Only if the path it was answered at no longer holds them, though:
 * another note that happens to hold the same bytes — two tasks from one
 * template — is another question. A version carrying a key the answered one
 * did (its meeting's identity) is the same note wherever it is. A failed
 * step answered nothing.
 */
export function handledVersions(
  entries: readonly LogEntry[],
  { ledger = null, holds = () => undefined }: HandledContext = {},
): HandledVersions {
  const now = ledgerNow(ledger, entries, MAX_LOG_ENTRIES);
  const answeredByDigest = new Map<string, { path: string }[]>();
  const answeredKeys = new Set<string>();
  for (const { path, keys } of now.answered) {
    const [digest = '', ...schemaKeys] = keys;
    answeredByDigest.set(digest, [...(answeredByDigest.get(digest) ?? []), { path }]);
    for (const key of schemaKeys.filter(isSchemaKey)) answeredKeys.add(key);
  }
  const hasHere = ({ path, digest }: NoteVersionRef): boolean =>
    now.paths.get(path)?.digests.includes(digest) === true;
  const isAnswered = ({ path, digest, keys = [] }: NoteVersionRef): boolean =>
    keys.some((key) => isSchemaKey(key) && answeredKeys.has(key)) ||
    (answeredByDigest.get(digest) ?? []).some(
      (answered) => answered.path === path || holds(answered.path) !== digest,
    );
  return {
    has: (version) => hasHere(version) || isAnswered(version),
    hasHere,
    hasPath: (path) => now.paths.has(path),
    vouchesFrom: now.vouchesFrom,
  };
}

/**
 * The paths, among one sync's changes, that a note the rule has handled left
 * — deleted, moved, renamed, archived, or replaced by a new note: their
 * history ends, for the log to say.
 */
export function leftHandledNotes(
  changes: readonly NoteChange[],
  handled: HandledVersions,
): VaultPath[] {
  const { left } = unpairedChanges(changes);
  return [...left].filter((path) => handled.hasPath(path)).map((path) => createVaultPath(path));
}

/** The versions not yet handled. */
export function unhandledVersions(
  versions: readonly NoteVersionRef[],
  handled: HandledVersions,
): NoteVersionRef[] {
  return versions.filter((version) => !handled.has(version));
}

/** A note as the index holds it now, with when its file was last written. */
export interface HeldNote extends NoteVersionRef {
  readonly type: string | null;
  readonly importOutcome?: string | undefined;
  /** It declares the meeting import's contract (`atlas_import`). */
  readonly importDeclared?: true | undefined;
  /** When the file was last written, as the disk says: milliseconds, on the clock the rule's file is dated by. */
  readonly modified: number;
}

/**
 * The meetings whose arrival a `created` rule never ran on (ADR-0028,
 * "Catching up when Atlas opens"), from what the files and the rule's log
 * say — the feed cannot: an arrival heard and not yet run on is held in
 * memory, and is gone once Atlas is quit.
 *
 * A meeting counts when it sits where meeting files land and the import let
 * it in, is of the trigger's type, was last written after the rule's own file
 * was (`since`: a rule does nothing about what was there before it was saved
 * or turned on, and the import's stamp is a meeting's last write until
 * someone edits it), and the rule's log holds nothing of it — no version at
 * its path, and not its words. In path order. A trigger that does not run on
 * `created` has none.
 */
export function missedArrivals({
  trigger,
  notes,
  handled,
  since,
}: {
  trigger: NoteTrigger;
  notes: Iterable<HeldNote>;
  handled: HandledVersions;
  /** When the rule's file was last written. */
  since: number;
}): NoteVersionRef[] {
  if (!trigger.on.includes('created')) return [];
  return [...notes]
    .filter(
      (note) =>
        isMeetingArrival(note) &&
        note.importOutcome === 'imported' &&
        note.type === trigger.type &&
        note.modified > Math.max(since, handled.vouchesFrom ?? since) &&
        !handled.hasPath(note.path) &&
        !handled.has(note),
    )
    .map(({ path, digest, keys }) =>
      keys === undefined ? { path, digest } : { path, digest, keys },
    )
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
