/**
 * What undo may believe of a run log (A25-01). A log is a note: a person, a
 * sync tool or another program can write any line into it. So undo reverses
 * only what the rule itself could have done, to values a property could have
 * held, on notes whose state still says the run did it. Anything else is
 * skipped and named, never carried out.
 */

import {
  ARCHIVED_FROM_KEY,
  ARCHIVED_KEY,
  archiveRefusal,
  unarchiveRefusal,
} from '../archive/archive.ts';
import { TASK_KEYS, TASK_TYPE } from '../gtd/gtd-status.ts';
import { linkTargets } from '../index/relation-rows.ts';
import { resolveWikiLinkTarget } from '../markdown/resolve-wikilink.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import { MEETING_PROJECT_KEY } from '../meeting-links/meeting-link-keys.ts';
import { isMeetingType } from '../meetings/meeting-header.ts';
import { isAtlasNote } from '../vault/vault-visibility.ts';
import { parentVaultPath, VAULT_ROOT, type VaultPath } from '../vault/vault-path.ts';
import { setKeyProblem, type AutomationAction } from './automation-rule.ts';
import { holdsNoProject } from './meeting-project-choice.ts';
import type { DoneAction, PriorValue } from './run-log.ts';
import type { LocalTime } from './schedule.ts';

/** A value a frontmatter property holds as a run found it: plain, or a list of plain values. */
const isScalar = (value: unknown): boolean =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const isPropertyValue = (prior: PriorValue): boolean =>
  'absent' in prior ||
  isScalar(prior.value) ||
  (Array.isArray(prior.value) && prior.value.every(isScalar));

/** What a set rule itself writes: text, a number, or true or false — never nothing. */
const isSetValue = (prior: PriorValue): boolean =>
  !('absent' in prior) && prior.value !== null && isScalar(prior.value);

/**
 * Why undo will not reverse this logged line for a rule with this action, or
 * null when the rule could have done it.
 */
export function loggedActionProblem(action: AutomationAction, line: DoneAction): string | null {
  const declared = action.kind === 'claude' && action.apply === 'mine';
  if (line.kind === 'summarised') {
    if (!declared) return 'Only the rule that makes your own action items writes a summary.';
    return isAtlasNote(line.path) ? 'DFAI keeps its own files as they are.' : null;
  }
  // The declared step's own tasks are logged with what it wrote, and trashed only while unchanged (#185).
  if (line.kind === 'created' && declared && line.digest !== undefined) {
    return isAtlasNote(line.path) ? 'DFAI keeps its own files as they are.' : null;
  }
  if (line.kind === 'proposed' || line.kind === 'created') {
    return 'What a Claude step made is answered in the Inbox, or kept or deleted by you; undo leaves it.';
  }
  if (action.kind === 'claude') return claudeLineProblem(action, line);
  if (line.kind === 'archived') {
    if (action.kind !== 'archive') return 'This rule sets properties; it never archived a note.';
    if (archiveRefusal(line.from) !== null || unarchiveRefusal(line.to) !== null) {
      return 'The log says it was archived somewhere the Archive does not put notes.';
    }
    return null;
  }
  if (line.kind !== 'set') return 'Undo only reverses what a run did, not what an undo did.';
  if (action.kind !== 'set') return 'This rule archives; it never set a property.';
  if (isAtlasNote(line.path)) return 'DFAI keeps its own files as they are.';
  if (setKeyProblem(line.key) !== null || !Object.hasOwn(action.values, line.key)) {
    return `This rule does not set “${line.key}”.`;
  }
  if (!isPropertyValue(line.before) || !isSetValue(line.after)) {
    return `The log gives “${line.key}” a value no property of a note holds.`;
  }
  return null;
}

/**
 * Why undo will not reverse a line of a Claude step's run: the only thing a
 * step sets is the project the declared step filed a meeting under (#227),
 * to a link, and only where `project` held nothing — anything else it never
 * did. That the note is a meeting is {@link claudeFiledNoteProblem}'s to say.
 */
function claudeLineProblem(
  action: Extract<AutomationAction, { kind: 'claude' }>,
  line: DoneAction,
): string | null {
  const never = 'This rule asks Claude; it never archived a note or set a property.';
  if (line.kind !== 'set' || action.apply !== 'mine') return never;
  if (line.key !== MEETING_PROJECT_KEY) return `This rule does not set “${line.key}”.`;
  if (isAtlasNote(line.path)) return 'DFAI keeps its own files as they are.';
  if (!isPropertyValue(line.before) || !isSetValue(line.after)) {
    return `The log gives “${line.key}” a value no property of a note holds.`;
  }
  if (!('absent' in line.before) && !holdsNoProject(line.before.value)) {
    return 'A Claude step only files a meeting whose project holds nothing; the log says it held something.';
  }
  return null;
}

/**
 * Why undo will not take `project` off this note, as it is now, for a Claude
 * step's run, or null when it is a meeting: the step files only meetings, so
 * a line naming any other note is not its doing, whatever the log says.
 */
export function claudeFiledNoteProblem(
  properties: Readonly<Record<string, unknown>>,
): string | null {
  return isMeetingType(properties['type'])
    ? null
    : 'A Claude step files only meetings, and this note is not one, so it was left as it is.';
}

/**
 * Why the note in the Archive is not the one this run put there, or null
 * when its stamp says it is: archived on the run's day, from where the log
 * says it was.
 */
export function unarchiveProblem({
  runAt,
  from,
  properties,
}: {
  runAt: LocalTime;
  from: VaultPath;
  properties: Readonly<Record<string, unknown>>;
}): string | null {
  const archived = properties[ARCHIVED_KEY];
  const stamped = typeof archived === 'string' ? archived.slice(0, 10) : null;
  if (stamped !== runAt.slice(0, 10) || properties[ARCHIVED_FROM_KEY] !== from) {
    return 'Its archive stamp is not this run’s, so it was left in the Archive.';
  }
  return null;
}

/** Which meeting a task the run logged as made is from, or why undo will not believe the run made it. */
export type MadeTaskReading =
  | { readonly ok: true; readonly meeting: VaultPath }
  | { readonly ok: false; readonly reason: string };

const NOT_ITS_TASK = 'It is not a task this rule made, so it was left.';

/**
 * Whether the note a run's log says the declared step made (#185) is one it
 * could have made (A25-01): a task, citing in `source` a meeting the same run
 * read, in the folder the run made tasks in. The log is a note anyone can
 * write into, and a digest anyone can work out, so neither vouches for a note
 * on its own: a person, a project or a meeting named in a forged line stays.
 */
export function madeTaskMeeting({
  path,
  properties,
  runMeetings,
  notePaths,
  home,
}: {
  path: VaultPath;
  /** The note's frontmatter, as it is now. */
  properties: Readonly<Record<string, unknown>>;
  /** The meetings the run's log says it read. */
  runMeetings: readonly VaultPath[];
  /** Every note in the vault: what the `source` link is resolved against. */
  notePaths: readonly VaultPath[];
  /** Where the run made its tasks: the task type's home folder on the run's day; null for the top. */
  home: VaultPath | null;
}): MadeTaskReading {
  if (properties['type'] !== TASK_TYPE) return { ok: false, reason: NOT_ITS_TASK };
  if (foldedVaultPath(parentVaultPath(path)) !== foldedVaultPath(home ?? VAULT_ROOT)) {
    return { ok: false, reason: NOT_ITS_TASK };
  }
  const source = properties[TASK_KEYS.source];
  const cited = (typeof source === 'string' ? linkTargets(source) : []).flatMap(
    (target) => resolveWikiLinkTarget(target, notePaths) ?? [],
  );
  const read = new Set(runMeetings.map(foldedVaultPath));
  const meeting = cited.find((each) => read.has(foldedVaultPath(each)));
  return meeting === undefined ? { ok: false, reason: NOT_ITS_TASK } : { ok: true, meeting };
}
