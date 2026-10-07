import { untickedValue, type StatusProperty } from '@atlas/domain';
import { propertyChange, type PropertyChanges } from './set-property.ts';

/**
 * The change a note's done checkbox makes to it.
 *
 * Ticking sets the status to the done option — as dropping a card in the done
 * column does, so a repeating task rolls on to its next date rather than
 * staying finished. Unticking puts back what the status held before it was
 * ticked, when the caller remembers it; otherwise where new work starts.
 */
export function doneChange({
  status,
  done,
  previous,
}: {
  status: StatusProperty;
  done: boolean;
  /** What the status held before this note was ticked, if this session saw it. */
  previous: string | null;
}): PropertyChanges {
  if (!done) return { [status.key]: untickedValue({ status, previous }) };
  return propertyChange({
    key: status.key,
    value: status.done,
    completion: {
      statusKey: status.key,
      doneValue: status.done,
      resetStatus: untickedValue({ status, previous: null }) ?? status.done,
    },
  });
}
