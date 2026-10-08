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
import { arrivedPaths, noteVersionKey, type NoteChange } from '../index/note-changes.ts';
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
 * the feed reported them: notes of its type that arrived — added, and not one
 * end of a move — or whose bytes changed. A note in the Archive is out of
 * play, as every query leaves it out; archiving a note is not its arrival.
 */
export function triggeringVersions(
  trigger: NoteTrigger,
  changes: readonly NoteChange[],
): NoteVersionRef[] {
  const arrived = arrivedPaths(changes);
  const hears = (change: NoteChange): boolean =>
    (trigger.on.includes('created') && arrived.has(change.path)) ||
    (trigger.on.includes('changed') && change.kind === 'changed');
  return changes
    .filter(
      (change) => change.type === trigger.type && !isArchivedPath(change.path) && hears(change),
    )
    .map((change) => ({ path: createVaultPath(change.path), digest: change.digest }));
}

/** Every version a rule's log says it handled, or left by its own write, as {@link noteVersionKey}s. */
export function handledVersions(entries: readonly LogEntry[]): ReadonlySet<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.kind === 'run'
        ? (entry.versions ?? []).map((version) => noteVersionKey(version.path, version.digest))
        : [],
    ),
  );
}

/** The versions not yet handled. */
export function unhandledVersions(
  versions: readonly NoteVersionRef[],
  handled: ReadonlySet<string>,
): NoteVersionRef[] {
  return versions.filter((version) => !handled.has(noteVersionKey(version.path, version.digest)));
}
