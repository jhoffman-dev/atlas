import { TASK_KEYS, WAITING_STATUS } from '../gtd/gtd-status.ts';
import { daysWaited } from '../linked-pages/linked-rows.ts';
import type { LinkedSectionId } from '../linked-pages/linked-sections.ts';
import type { BoardRow } from '../query/group-rows.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { noteCitation, sourceCitation, type Citation, type Linking } from './citation.ts';
import type { FollowUpRow } from './assistant-queries.ts';

/*
 * The items the assistant's tools answer with (P32-04), made from what a
 * linked page's sections (P30-06) already read from the index: each note
 * cited, each task with the turn it came from when its `source` says, and
 * each listed once.
 */

/** A note an answer names, and the link that opens it. */
export interface CitedNote {
  readonly path: string;
  readonly title: string;
  readonly cite: Citation;
}

/** A meeting or a decision: a note with the day it is dated, null when undated. */
export interface DatedNote extends CitedNote {
  readonly date: string | null;
}

/** A decision, and the turn it came from when its `source` says. */
export interface CitedDecision extends DatedNote {
  readonly source: Citation | null;
}

/** An open task, a waiting-for or a follow-up. */
export interface LoopTask extends CitedNote {
  readonly status: string | null;
  readonly due: string | null;
  /** Due before the day asked about, and not finished. */
  readonly overdue: boolean;
  /** Who it waits on, as the task writes it; null when it does not say or is not waiting. */
  readonly waitingOn: string | null;
  /** For a waiting-for, whole days since its file last changed (ADR-0029); null otherwise. */
  readonly waitingDays: number | null;
  /** The meeting turn (or note) it says it came from, as its `source` writes it. */
  readonly source: Citation | null;
}

/** A section of a linked page as it was answered: what the items here are made from. */
export interface AnsweredSection {
  readonly id: LinkedSectionId;
  readonly rows: readonly BoardRow[];
  readonly truncated: boolean;
  readonly problem: string | null;
}

/** What turns rows into items: how to link a note, and each note's `source`. */
export interface ItemContext extends Linking {
  readonly sources: ReadonlyMap<string, string>;
  /** The day asked about, `YYYY-MM-DD`: what is overdue, and how long a waiting-for has waited. */
  readonly day: string;
}

const DATE_KEY = 'date';
const MODIFIED_KEY = 'modified';

/** A value as one line of text: a list joined, nothing as null. */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === 'string' && part !== '');
    return parts.length === 0 ? null : parts.join(', ');
  }
  return null;
}

/** A day as written, `YYYY-MM-DD`, when the value starts with one. */
export function dayOf(value: unknown): string | null {
  const text = textOf(value);
  return text !== null && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

export function citedNote(row: Pick<BoardRow, 'path' | 'title'>, context: ItemContext): CitedNote {
  return {
    path: row.path,
    title: row.title,
    cite: noteCitation(createVaultPath(row.path), context.targetOf),
  };
}

export function datedNote(row: BoardRow, context: ItemContext): DatedNote {
  return { ...citedNote(row, context), date: dayOf(row.values[DATE_KEY]) };
}

function sourceOf(path: string, context: ItemContext): Citation | null {
  return sourceCitation(context.sources.get(path), context.resolve);
}

export function citedDecision(row: BoardRow, context: ItemContext): CitedDecision {
  return { ...datedNote(row, context), source: sourceOf(row.path, context) };
}

/** How the vault's Task type says a task's status and that it is finished. */
export interface TaskStatusWords {
  readonly key: string;
  /** The status that finishes a task; null when the type has none. */
  readonly done: string | null;
}

/**
 * A task row as an item, its status read as the Task type says it. A row of
 * a page's Waiting for section is waiting though the section does not show
 * its status.
 */
export function loopTask({
  row,
  words,
  context,
  waiting = false,
}: {
  row: BoardRow;
  words: TaskStatusWords;
  context: ItemContext;
  waiting?: boolean;
}): LoopTask {
  const status = textOf(row.values[words.key]) ?? (waiting ? WAITING_STATUS : null);
  const due = dayOf(row.values[TASK_KEYS.due]);
  const waits = status === WAITING_STATUS;
  return {
    ...citedNote(row, context),
    status,
    due,
    overdue: due !== null && due < context.day && (words.done === null || status !== words.done),
    waitingOn: waits ? textOf(row.values[TASK_KEYS.waitingOn]) : null,
    waitingDays: waits ? daysWaited(row.values[MODIFIED_KEY], context.day) : null,
    source: sourceOf(row.path, context),
  };
}

/** A follow-up the index found from a page's meetings, as an item. */
export function followUpTask(row: FollowUpRow, context: ItemContext): LoopTask {
  const due = dayOf(row.due);
  return {
    ...citedNote(row, context),
    status: row.status,
    due,
    overdue: due !== null && due < context.day,
    waitingOn: null,
    waitingDays: null,
    source: sourceCitation(row.source, context.resolve),
  };
}

/** The rows of the page's section of that id; none when the page has no such section. */
export function sectionRowsOf(
  sections: readonly AnsweredSection[],
  id: LinkedSectionId,
): readonly BoardRow[] {
  return sections.find((section) => section.id === id)?.rows ?? [];
}

/**
 * Dated on or before `day`, in the order given — the index's, newest first —
 * at most `limit`. An undated note is kept: nobody dated it, which does not
 * make it later than the day.
 */
export function onOrBefore<Note extends DatedNote>(
  notes: readonly Note[],
  day: string,
  limit: number,
): Note[] {
  return notes.filter((note) => note.date === null || note.date <= day).slice(0, limit);
}

/** Every note whose path is not one of `listed`: an item is listed under one heading only. */
export function notListed<Note extends CitedNote>(
  notes: readonly Note[],
  listed: readonly CitedNote[],
): Note[] {
  const taken = new Set(listed.map((note) => note.path));
  return notes.filter((note) => !taken.has(note.path));
}
