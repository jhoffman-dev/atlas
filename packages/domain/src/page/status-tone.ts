import { GTD_STATUS_LABELS, isGtdStatus } from '../gtd/gtd-status.ts';

/**
 * The colour ramp a status pill takes. The five match the board's columns;
 * any other value is drawn in the quietest one rather than guessed at.
 */
export type StatusTone = 'backlog' | 'next' | 'doing' | 'review' | 'done';

/** The ramp, in the order it runs: what an option's colour can be picked from. */
export const STATUS_TONES: readonly StatusTone[] = ['backlog', 'next', 'doing', 'review', 'done'];

const TONES: Readonly<Record<string, StatusTone>> = {
  backlog: 'backlog',
  todo: 'backlog',
  next: 'next',
  doing: 'doing',
  'in progress': 'doing',
  review: 'review',
  done: 'done',
  complete: 'done',
  // GTD's statuses (ADR-0029): what can be done now is `next`, started work is
  // `doing`, waiting on someone is `review`, and finished work is `done`.
  'next-action': 'next',
  'in-progress': 'doing',
  waiting: 'review',
  archive: 'done',
};

export function statusTone(value: string): StatusTone {
  return TONES[value.trim().toLowerCase()] ?? 'backlog';
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
