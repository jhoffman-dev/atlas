import { isArchivedPath } from '../archive/archive.ts';
import {
  GTD_STATUSES,
  GTD_STATUS_LABELS,
  isGtdStatus,
  NEW_TASK_STATUS,
  TASK_KEYS,
  TASK_TYPE,
} from '../gtd/gtd-status.ts';
import { isTaskNote, taskRuleChanges } from '../gtd/task-rules.ts';
import { TASK_TYPE_FILE } from '../gtd/task-type.ts';
import { wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { PROPOSAL_TYPE } from '../proposals/proposal.ts';
import { addDays } from '../timeline/timeline.ts';
import { relationTypeRefusal } from '../types/property-value.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { isAtlasNote } from '../vault/vault-visibility.ts';
import { filedUnderStamp, isInInbox } from './inbox.ts';

type Properties = Readonly<Record<string, unknown>>;

/**
 * What clarifying an Inbox item decides (#112), every part optional: a key
 * left out is left as the note has it, and a null takes what it held away.
 */
export interface Clarification {
  /** One of the eight GTD statuses. */
  readonly status?: string;
  /** The project or area to file it under. */
  readonly project?: VaultPath;
  /** The person it waits on. */
  readonly waitingOn?: VaultPath | null;
  /** `YYYY-MM-DD`: the day it comes back into view. */
  readonly defer?: string | null;
  /** `YYYY-MM-DD`. */
  readonly due?: string | null;
  /** Where it can be done; an empty list takes them away. */
  readonly contexts?: readonly string[];
  /** Makes a plain note a task, starting in the Inbox unless a status is given. */
  readonly asTask?: boolean;
}

/** What a clarification comes to: one write of the note, and whether it is then filed. */
export type ClarifyPlan =
  | {
      /** The properties to write in one save; none when the note is only filed. */
      readonly changes: Properties;
      /** The project or area the note moves under, or null when it stays where it is. */
      readonly fileUnder: VaultPath | null;
    }
  | { readonly refused: string };

const TASK_ONLY =
  'Only a task is given a status, someone to wait on or a date: file this note under a project, or make it a task first.';

/** Whether `day` is a calendar day written `YYYY-MM-DD`. */
const isDay = (day: string) => addDays(day, 0) === day;

const typeOf = (properties: Properties) => {
  const type = properties['type'];
  return typeof type === 'string' && type.trim() !== '' ? type.trim() : null;
};

/** The properties a clarification names for a task, before the task rules: a null takes a key out. */
function taskChanges(
  { status, waitingOn, defer, due, contexts }: Clarification,
  notePaths: readonly VaultPath[],
): { changes: Record<string, unknown> } | { refused: string } {
  const changes: Record<string, unknown> = {};
  if (status !== undefined) {
    if (!isGtdStatus(status)) {
      const eight = GTD_STATUSES.map((each) => GTD_STATUS_LABELS[each]).join(', ');
      return { refused: `“${status}” is not a status a task can have: ${eight}.` };
    }
    changes[TASK_KEYS.status] = status;
  }
  for (const [key, day] of [
    [TASK_KEYS.defer, defer],
    [TASK_KEYS.due, due],
  ] as const) {
    if (day === undefined) continue;
    if (day !== null && !isDay(day)) return { refused: `“${day}” is not a day (YYYY-MM-DD).` };
    changes[key] = day;
  }
  if (waitingOn !== undefined) {
    changes[TASK_KEYS.waitingOn] =
      waitingOn === null ? null : `[[${wikiLinkTargetFor(waitingOn, notePaths)}]]`;
  }
  if (contexts !== undefined) {
    const named = contexts.map((context) => context.trim()).filter((context) => context !== '');
    changes[TASK_KEYS.contexts] = named.length === 0 ? null : [...new Set(named)];
  }
  return { changes };
}

/** A plain note made a task, or why it may not be; no change for one that already is. */
function asTaskChanges(
  properties: Properties,
  status: string | undefined,
): { changes: Record<string, unknown> } | { refused: string } {
  if (isTaskNote(properties)) return { changes: {} };
  const type = typeOf(properties);
  if (type !== null) return { refused: `It is a ${type}: only a plain note is made a task.` };
  return {
    changes: {
      type: TASK_TYPE,
      ...(status === undefined && { [TASK_KEYS.status]: NEW_TASK_STATUS }),
    },
  };
}

/**
 * What clarifying a note writes and whether it is then filed (#112), or why
 * not — judged whole, before anything is written:
 *
 * - A proposal is answered, never clarified. Only a task takes a status, a
 *   wait or a date; any other note can be filed, or made a task (`asTask`)
 *   when it has no type of its own.
 * - Everything the row decided is one change, held to the task rules as any
 *   change is: Waiting with nobody to wait on is refused, Waiting chosen
 *   with its person passes as one save.
 * - A project files a note that is in the `Inbox` folder — moved into the
 *   project's folder and linked. A task waiting anywhere else already has
 *   its place: it is linked to the project and stays where it is.
 */
export function clarifyPlan({
  path,
  properties,
  clarification,
  notePaths,
  today,
}: {
  path: VaultPath;
  /** The note's properties as its file has them. */
  properties: Properties;
  clarification: Clarification;
  /** Every note in the vault, so a link is written the way every link is. */
  notePaths: readonly VaultPath[];
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
}): ClarifyPlan {
  if (typeOf(properties)?.toLowerCase() === PROPOSAL_TYPE) {
    return { refused: 'A proposal is answered, not clarified: accept or reject it.' };
  }
  const made =
    clarification.asTask === true ? asTaskChanges(properties, clarification.status) : null;
  if (made !== null && 'refused' in made) return made;
  const named = taskChanges(clarification, notePaths);
  if ('refused' in named) return named;
  const task = isTaskNote({ ...properties, ...made?.changes });
  if (!task && Object.keys(named.changes).length > 0) return { refused: TASK_ONLY };

  const project = clarification.project ?? null;
  const fileUnder = project !== null && isInInbox(path) ? project : null;
  const linksOnly = project !== null && fileUnder === null;
  if (linksOnly && !task) return { refused: 'It is not in the Inbox.' };
  const linked = linksOnly ? filedUnderStamp({ project, notePaths }) : {};
  const changes = { ...made?.changes, ...named.changes, ...linked };
  if (Object.keys(changes).length === 0 && fileUnder === null) {
    return { refused: 'Nothing was chosen: give it a status, a project, a person or a date.' };
  }
  const ruled = taskRuleChanges({ before: properties, changes, today });
  if ('refused' in ruled) return ruled;
  return { changes: ruled.changes, fileUnder };
}

/** The Task type's own `waiting_on`, whose target says who a task can wait on. */
const WAITING_ON = TASK_TYPE_FILE.type.properties.find(
  (property) => property.key === TASK_KEYS.waitingOn,
);

/**
 * Why a note cannot be who a task waits on, or null when it can: a person
 * still in use — not archived, not one of Atlas's own files.
 */
export function waitingOnRefusal({
  path,
  type,
}: {
  path: VaultPath;
  /** The note's `type:`, or null when it has none. */
  type: string | null;
}): string | null {
  if (isAtlasNote(path)) return 'A task waits on a person, not on one of Atlas’s own files.';
  if (isArchivedPath(path)) return 'That person is archived: unarchive them to wait on them.';
  if (type === null) return 'A task waits on a person, and that note is not one.';
  if (WAITING_ON === undefined) return null;
  return relationTypeRefusal({ def: WAITING_ON, linkedType: type.trim().toLowerCase() });
}
