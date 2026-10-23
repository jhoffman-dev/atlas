import { WAITING_STATUS } from '../gtd/gtd-status.ts';
import type { BoardRow } from '../query/group-rows.ts';
import type { FollowUpRow } from './assistant-queries.ts';
import {
  citedDecision,
  citedNote,
  datedNote,
  followUpTask,
  dayOf,
  loopTask,
  notListed,
  onOrBefore,
  sectionRowsOf,
  type AnsweredSection,
  type CitedDecision,
  type CitedNote,
  type DatedNote,
  type ItemContext,
  type LoopTask,
  type TaskStatusWords,
} from './assistant-items.ts';

/*
 * What a brief and the open loops of a Person, Company, Project, Area or
 * Meeting say (P32-04), put together from its linked page's sections and the
 * follow-ups found from its meetings. Every rule of what goes where is here;
 * reading the sections is the application's.
 */

/** The most items one list of an answer holds; `truncated` says when there were more. */
export const LOOP_LIMIT = 50;
/** The meetings a brief lists, newest first. */
export const BRIEF_MEETINGS = 5;
/** The decisions a brief lists, newest first. */
export const BRIEF_DECISIONS = 10;
/** The linked notes changed lately that a brief lists, as "recent mentions". */
export const BRIEF_MENTIONS = 10;

/** What is still open around a page: its tasks, who it waits on, and what to chase. */
export interface OpenLoops {
  /** Open tasks that are neither waiting-fors nor follow-ups, as the page orders them. */
  readonly openTasks: readonly LoopTask[];
  /** Tasks waiting on someone, the longest untouched first where the page orders them so. */
  readonly waitingFor: readonly LoopTask[];
  /** Open tasks tagged `#follow-up` linked with the page or one of its meetings: the owner's to chase. */
  readonly followUps: readonly LoopTask[];
  /** Whether a list was cut at {@link LOOP_LIMIT}, or the index held rows back. */
  readonly truncated: boolean;
}

interface Capped<Item> {
  readonly items: Item[];
  readonly cut: boolean;
}

function capped<Item>(items: readonly Item[], limit: number): Capped<Item> {
  return { items: items.slice(0, limit), cut: items.length > limit };
}

/** A page's open loops, each listed once: a waiting-for before a follow-up, a follow-up before a task. */
export function openLoopsOf({
  sections,
  followUps,
  status,
  context,
}: {
  sections: readonly AnsweredSection[];
  followUps: readonly FollowUpRow[];
  status: TaskStatusWords;
  context: ItemContext;
}): OpenLoops {
  const open = (task: LoopTask) => status.done === null || task.status !== status.done;
  const tasks = sectionRowsOf(sections, 'tasks')
    .map((row) => loopTask({ row, words: status, context }))
    .filter(open);
  const hasWaitingSection = sections.some((section) => section.id === 'waiting');
  const waiting = hasWaitingSection
    ? sectionRowsOf(sections, 'waiting').map((row) =>
        loopTask({ row, words: status, context, waiting: true }),
      )
    : tasks.filter((task) => task.status === WAITING_STATUS);
  const chased = notListed(
    followUps.map((row) => followUpTask(row, context)),
    waiting,
  );
  const rest = notListed(notListed(tasks, waiting), chased);
  const lists = [capped(rest, LOOP_LIMIT), capped(waiting, LOOP_LIMIT), capped(chased, LOOP_LIMIT)];
  const held = sections.some(
    (section) => (section.id === 'tasks' || section.id === 'waiting') && section.truncated,
  );
  const [openTasks, waitingFor, chase] = lists;
  return {
    openTasks: openTasks?.items ?? [],
    waitingFor: waitingFor?.items ?? [],
    followUps: chase?.items ?? [],
    truncated: held || lists.some((list) => list.cut),
  };
}

/** What came of the last meeting: every task joined to it, finished or not, and its decisions. */
export interface LastMeeting {
  readonly meeting: DatedNote;
  readonly tasks: readonly LoopTask[];
  readonly decisions: readonly CitedNote[];
}

/** A note linked with the page whose kind of link its section says: a person, a company or a project. */
export interface RelatedNote extends CitedNote {
  readonly relation: 'person' | 'company' | 'project';
}

/** Everything a brief says besides its open loops. */
export interface BriefParts {
  /** The newest meeting dated on or before the day: when the page was last met; null when never. */
  readonly lastTouch: DatedNote | null;
  /** Meetings dated on or before the day, newest first; an undated one after them. */
  readonly meetings: readonly DatedNote[];
  readonly lastMeeting: LastMeeting | null;
  /** Decisions dated on or before the day, newest first. */
  readonly decisions: readonly CitedDecision[];
  /** Other notes linked with the page, changed in the last 30 days. */
  readonly mentions: readonly CitedNote[];
  /** The people, companies and projects the page's sections name. */
  readonly related: readonly RelatedNote[];
  /** Whether a list was cut, or the index held rows back. */
  readonly truncated: boolean;
}

const RELATED = [
  ['people', 'person'],
  ['companies', 'company'],
  ['projects', 'project'],
] as const;

const DATE_KEY = 'date';

/**
 * The meeting the page last met in: the newest of its meetings dated on or
 * before `day`, the first listed of a day's; null when it has none. An
 * undated meeting is never the last one — nothing says when it was.
 */
export function lastMeetingRow(sections: readonly AnsweredSection[], day: string): BoardRow | null {
  let latest: { row: BoardRow; date: string } | null = null;
  for (const row of sectionRowsOf(sections, 'meetings')) {
    const date = dayOf(row.values[DATE_KEY]);
    if (date === null || date > day) continue;
    if (latest === null || date > latest.date) latest = { row, date };
  }
  return latest?.row ?? null;
}

/** The rest of a brief, from the page's sections and, when it has one, its last meeting's. */
export function briefPartsOf({
  sections,
  lastMeetingSections,
  status,
  context,
}: {
  sections: readonly AnsweredSection[];
  /** The last meeting's own sections; empty when there is none. */
  lastMeetingSections: readonly AnsweredSection[];
  status: TaskStatusWords;
  context: ItemContext;
}): BriefParts {
  const all = sectionRowsOf(sections, 'meetings').map((row) => datedNote(row, context));
  const touched = lastMeetingRow(sections, context.day);
  const lastTouch = touched === null ? null : datedNote(touched, context);
  const meetings = onOrBefore(all, context.day, BRIEF_MEETINGS + 1);
  const decided = sectionRowsOf(sections, 'decisions').map((row) => citedDecision(row, context));
  const decisions = onOrBefore(decided, context.day, BRIEF_DECISIONS + 1);
  const mentioned = sectionRowsOf(sections, 'notes').map((row) => citedNote(row, context));
  const related = RELATED.flatMap(([id, relation]) =>
    sectionRowsOf(sections, id).map((row) => ({ ...citedNote(row, context), relation })),
  );
  return {
    lastTouch,
    meetings: meetings.slice(0, BRIEF_MEETINGS),
    lastMeeting:
      lastTouch === null ? null : lastMeetingOf(lastTouch, lastMeetingSections, status, context),
    decisions: decisions.slice(0, BRIEF_DECISIONS),
    mentions: mentioned.slice(0, BRIEF_MENTIONS),
    related: related.slice(0, LOOP_LIMIT),
    truncated:
      meetings.length > BRIEF_MEETINGS ||
      decisions.length > BRIEF_DECISIONS ||
      mentioned.length > BRIEF_MENTIONS ||
      related.length > LOOP_LIMIT ||
      sections.some((section) => section.truncated),
  };
}

function lastMeetingOf(
  meeting: DatedNote,
  sections: readonly AnsweredSection[],
  status: TaskStatusWords,
  context: ItemContext,
): LastMeeting {
  return {
    meeting,
    tasks: sectionRowsOf(sections, 'tasks')
      .map((row) => loopTask({ row, words: status, context }))
      .slice(0, LOOP_LIMIT),
    decisions: sectionRowsOf(sections, 'decisions')
      .map((row) => citedNote(row, context))
      .slice(0, BRIEF_DECISIONS),
  };
}
