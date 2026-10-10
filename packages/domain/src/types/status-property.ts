import { REOPENED_TASK_STATUS } from '../gtd/gtd-status.ts';
import { statusTone } from '../page/status-tone.ts';
import type { ObjectType, PropertyDef } from './property-def.ts';

/** The select a type's notes are ticked done by, and what ticking means. */
export interface StatusProperty {
  /** The frontmatter key the status is stored under. */
  readonly key: string;
  /** The option that means finished: what a tick writes. */
  readonly done: string;
  /** Every option, in the order work moves through them. */
  readonly options: readonly string[];
}

const isSelect = (property: PropertyDef) => property.kind === 'select';

/**
 * The status a type's notes are ticked done by, or null when nothing in the
 * type means finished.
 *
 * A select that names its done option (`done: shipped` in the type file) wins.
 * A type written before that marker existed still gets a checkbox: its first
 * select with an option whose name says finished — `done`, `complete` — is
 * taken as the status.
 */
export function statusOf(type: ObjectType | null): StatusProperty | null {
  if (type === null) return null;
  const selects = type.properties.filter(isSelect);

  const declared = selects.find((property) => property.done !== undefined);
  if (declared?.done !== undefined) return statusFrom(declared, declared.done);

  for (const property of selects) {
    const done = property.options.find((option) => statusTone(option) === 'done');
    if (done !== undefined) return statusFrom(property, done);
  }
  return null;
}

function statusFrom(property: PropertyDef, done: string): StatusProperty {
  return { key: property.key, done, options: property.options };
}

/** Whether a note holding this status value counts as finished. */
export function isDoneValue(status: StatusProperty, value: unknown): boolean {
  return typeof value === 'string' && value === status.done;
}

/**
 * The status worth keeping when a note is ticked, so unticking can put it
 * back: what the note held, unless that was already done or was no status.
 */
export function statusToRemember({
  status,
  value,
}: {
  status: StatusProperty;
  value: unknown;
}): string | null {
  return typeof value === 'string' && value !== '' && value !== status.done ? value : null;
}

/**
 * What unticking puts the status back to: the value it held before it was
 * ticked, when that is known and is still an option; otherwise Next Action
 * for a GTD task (ADR-0029), and for any other the first option that is not
 * the done one — where new work starts.
 */
export function untickedValue({
  status,
  previous,
}: {
  status: StatusProperty;
  previous: string | null;
}): string | null {
  if (previous !== null && previous !== status.done && status.options.includes(previous)) {
    return previous;
  }
  // A GTD task reopened with nothing remembered is something to do next, not new work to sort.
  if (status.done !== REOPENED_TASK_STATUS && status.options.includes(REOPENED_TASK_STATUS)) {
    return REOPENED_TASK_STATUS;
  }
  return status.options.find((option) => option !== status.done) ?? null;
}
