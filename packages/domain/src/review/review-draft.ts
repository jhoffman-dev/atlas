/**
 * What the Friday review draft (#40) is handed: the weekly review's sections
 * (P30-07), the week's finished tasks and meetings, and the Inbox's count —
 * each item with its note's path, which the draft must cite
 * (`cited-items.ts`). Data, fenced as the notes are, never instructions.
 */

import type { PromptData } from '../automations/proposal-schema.ts';
import { addDays } from '../timeline/timeline.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  DAY_MS,
  STALE_WAITING_DAYS,
  UNTOUCHED_SOMEDAY_DAYS,
  type ReviewTask,
  type WeeklyReview,
} from './weekly-review.ts';

/** How far back the draft looks for what got done and who met: a week. */
export const REVIEW_DRAFT_DAYS = 7;

/** The most items one section lists: the draft is a week's review, not the vault. */
export const REVIEW_DRAFT_SECTION_ITEMS = 50;

/** A note the draft may cite: a finished task, or a meeting and its day. */
export interface ReviewSource {
  readonly path: VaultPath;
  readonly title: string;
  /** A meeting's day, `YYYY-MM-DD`. */
  readonly date?: string;
}

/** Everything the draft is worked out from, read at one moment. */
export interface ReviewDraftInput {
  readonly review: WeeklyReview;
  readonly done: readonly ReviewSource[];
  readonly meetings: readonly ReviewSource[];
  readonly inbox: { readonly toFile: number; readonly toAnswer: number; readonly more: boolean };
  /** The index held rows back, so a section may be missing items. */
  readonly truncated: boolean;
  readonly today: string;
  /** Milliseconds since the epoch, from the injected clock. */
  readonly now: number;
}

/**
 * Since when the draft counts the week, from the injected clock: tasks
 * finished since `since` (milliseconds) and meetings held from `sinceDay`.
 * The day is counted on the calendar, so a clock change moves neither.
 */
export function reviewDraftWindow({ today, now }: { today: string; now: number }): {
  since: number;
  sinceDay: string;
} {
  return {
    since: now - REVIEW_DRAFT_DAYS * DAY_MS,
    sinceDay: addDays(today, -REVIEW_DRAFT_DAYS) ?? today,
  };
}

/** The data the step is handed, and the notes it may cite. */
export interface ReviewDraftData {
  readonly data: readonly PromptData[];
  readonly sources: readonly VaultPath[];
}

/** Each section of the draft's data, the items it lists, and how each is said. */
export function reviewDraftData(input: ReviewDraftInput): ReviewDraftData {
  const { review, now } = input;
  const since = (task: ReviewTask) =>
    `untouched for ${Math.floor((now - task.modified) / DAY_MS)} days`;
  const sections: readonly Section[] = [
    { about: `Done in the last ${REVIEW_DRAFT_DAYS} days`, items: input.done.map(plainLine) },
    {
      about: `Meetings in the last ${REVIEW_DRAFT_DAYS} days`,
      items: input.meetings.map((meeting) => sourceLine(meeting, meeting.date ?? '')),
    },
    {
      about: `Waiting on someone for more than ${STALE_WAITING_DAYS} days`,
      items: review.staleWaiting.map((task) =>
        sourceLine(task, `waiting on ${task.waitingOn || 'nobody named'}, ${since(task)}`),
      ),
    },
    {
      about: 'Overdue',
      items: review.overdue.map((task) => sourceLine(task, `due ${task.due ?? ''}`)),
    },
    {
      about: 'Active projects with no next action',
      items: review.projectsWithoutNextAction.map(plainLine),
    },
    {
      about: `Someday, untouched for more than ${UNTOUCHED_SOMEDAY_DAYS} days`,
      items: review.untouchedSomeday.map((task) => sourceLine(task, since(task))),
    },
  ];
  const shown = sections.map(({ about, items }) => ({
    about,
    items: items.slice(0, REVIEW_DRAFT_SECTION_ITEMS),
    more: Math.max(0, items.length - REVIEW_DRAFT_SECTION_ITEMS),
  }));
  return {
    data: [...shown.map(sectionData), inboxData(input)],
    sources: [...new Set(shown.flatMap(({ items }) => items.map((item) => item.path)))],
  };
}

interface Section {
  readonly about: string;
  readonly items: readonly SectionItem[];
}

interface SectionItem {
  readonly path: VaultPath;
  readonly line: string;
}

/** "- [[Tasks/Send the file.md]] Send the file — due 2026-10-20". */
function sourceLine(note: { path: VaultPath; title: string }, detail: string): SectionItem {
  const after = detail === '' ? '' : ` — ${detail}`;
  return { path: note.path, line: `- [[${note.path}]] ${note.title}${after}` };
}

const plainLine = (note: { path: VaultPath; title: string }): SectionItem => sourceLine(note, '');

function sectionData({
  about,
  items,
  more,
}: {
  about: string;
  items: readonly SectionItem[];
  more: number;
}): PromptData {
  const lines = items.length === 0 ? ['None.'] : items.map((item) => item.line);
  return { about, text: [...lines, ...(more > 0 ? [`And ${more} more.`] : [])].join('\n') };
}

function inboxData({ inbox, truncated }: ReviewDraftInput): PromptData {
  const notes = `${inbox.more ? 'More than ' : ''}${inbox.toFile} notes to file`;
  const held = truncated
    ? ' The vault holds more tasks than were read: a section may be short.'
    : '';
  return {
    about: 'The Inbox',
    text: `${notes}, ${inbox.toAnswer} proposals to answer.${held}`,
  };
}
