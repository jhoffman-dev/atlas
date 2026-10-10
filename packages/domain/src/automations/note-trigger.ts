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
import { parseAtlasQuery } from '../query-language/parse.ts';
import { QueryTextError } from '../query-language/query-text-error.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import type { LogEntry } from './run-log.ts';

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
 */
export function triggeringVersions(
  trigger: NoteTrigger,
  changes: readonly NoteChange[],
): NoteVersionRef[] {
  const arrived = arrivedPaths(changes);
  const hears = (change: NoteChange): boolean =>
    (trigger.on.includes('created') && arrived.has(change.path)) ||
    (trigger.on.includes('changed') && change.kind === 'changed' && !arrived.has(change.path));
  return changes
    .filter(
      (change) => change.type === trigger.type && !isArchivedPath(change.path) && hears(change),
    )
    .map((change) => ({ path: createVaultPath(change.path), digest: change.digest }));
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
  /** Whether it handled any version of the note at this path. */
  readonly hasPath: (path: string) => boolean;
}

/**
 * Every version a rule's log says it handled, or left by its own write —
 * read oldest first, so a path a note has left since has no history: a new
 * note there is new to the rule. A note left a path when the log says it
 * `went` — deleted, moved, renamed or archived by someone else, or replaced
 * — or when the run itself archived it.
 */
export function handledVersions(entries: readonly LogEntry[]): HandledVersions {
  const byPath = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.kind !== 'run') continue;
    for (const path of entry.went ?? []) byPath.delete(path);
    for (const { path, digest } of entry.versions ?? []) {
      byPath.set(path, (byPath.get(path) ?? new Set()).add(digest));
    }
    for (const action of entry.done) if (action.kind === 'archived') byPath.delete(action.from);
  }
  return {
    has: ({ path, digest }) => byPath.get(path)?.has(digest) === true,
    hasPath: (path) => byPath.has(path),
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
