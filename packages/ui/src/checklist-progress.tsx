import { rowChecklistProgress } from '@atlas/domain';

/**
 * How far through its checklist a note is (P30-03): a bar, and the share
 * ticked as a percentage. Drawn on a card, a list row and a table row of a
 * note with a box in it; nothing for one with none.
 */
export function ChecklistProgress({
  values,
  kinds,
}: {
  values: Readonly<Record<string, unknown>>;
  /** The view's declared kinds: a type with a `progress` of its own draws no bar for it. */
  kinds: Readonly<Record<string, unknown>>;
}) {
  const percent = rowChecklistProgress({ values, kinds });
  if (percent === null) return null;
  return (
    <span
      className="checklist-progress"
      role="progressbar"
      aria-label="Checklist progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span className="checklist-progress__track" aria-hidden="true">
        <span className="checklist-progress__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="checklist-progress__label">{percent}%</span>
    </span>
  );
}
