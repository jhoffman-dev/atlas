import { GTD_STATUS_LABELS, isGtdStatus } from '../gtd/gtd-status.ts';

/**
 * The colour ramp a status pill takes. The seven are the design's statuses
 * (docs/design/ui-v2-brief.md §3); any other value is drawn in the quietest
 * one rather than guessed at.
 */
export type StatusTone = 'inbox' | 'backlog' | 'next' | 'doing' | 'waiting' | 'review' | 'done';

/** The ramp, in the order it runs: what an option's colour can be picked from. */
export const STATUS_TONES: readonly StatusTone[] = [
  'inbox',
  'backlog',
  'next',
  'doing',
  'waiting',
  'review',
  'done',
];

const TONES: Readonly<Record<string, StatusTone>> = {
  inbox: 'inbox',
  backlog: 'backlog',
  todo: 'backlog',
  next: 'next',
  doing: 'doing',
  'in progress': 'doing',
  waiting: 'waiting',
  review: 'review',
  done: 'done',
  complete: 'done',
  // GTD's statuses (ADR-0029): what can be done now is `next`, started work is
  // `doing`; Someday and Longterm share Backlog's grey, and Archive is drawn
  // in Done's green (epic #267). Each keeps its own label, so the shared
  // colour never has to tell them apart.
  'next-action': 'next',
  'in-progress': 'doing',
  someday: 'backlog',
  longterm: 'backlog',
  archive: 'done',
};

export function statusTone(value: string): StatusTone {
  return TONES[value.trim().toLowerCase()] ?? 'backlog';
}

/**
 * Whether a value is a status the ramp knows — one of the seven, an alias such
 * as "Complete", or a GTD status — as against a custom option, a gathered
 * "Other" or no value, which `statusTone` draws in Backlog's grey for want of
 * better. A chart that colours by status asks this first, so two groups that
 * are not statuses are never painted the same.
 */
export function isKnownStatus(value: string): boolean {
  return Object.hasOwn(TONES, value.trim().toLowerCase());
}

/** The property a note's tint is read from, wherever it is drawn small. */
const STATUS_KEY = 'status';

/**
 * The tone a note is tinted with on a calendar or a timeline, where there is
 * no room for a pill: its status's. A note with no status is not tinted, rather
 * than drawn as backlog it may not be.
 */
export function noteTone(values: Readonly<Record<string, unknown>>): StatusTone | null {
  const status = values[STATUS_KEY];
  if (typeof status !== 'string' || status.trim() === '') return null;
  return statusTone(status);
}

/**
 * A select's value as a pill's text: `backlog` reads "Backlog", and a GTD
 * status reads as James writes it — `next-action` is "Next Action".
 */
export function optionLabel(value: string): string {
  const trimmed = value.trim();
  if (isGtdStatus(trimmed)) return GTD_STATUS_LABELS[trimmed];
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
