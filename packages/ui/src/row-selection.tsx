import { useEffect, useRef } from 'react';

/** Which rows of a list are chosen, and how to change that — held by the caller. */
export interface RowSelection {
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  /** Chooses every one of `paths`, or none of them. */
  readonly onToggleAll: (args: { paths: readonly string[]; select: boolean }) => void;
}

/** One row's box, or the heading's box for every row. */
export function SelectBox({
  label,
  checked,
  mixed = false,
  onChange,
}: {
  /** Read aloud: which row it chooses, or "Select all". */
  label: string;
  checked: boolean;
  /** Some rows but not all, for the heading's box. */
  mixed?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  // `indeterminate` is a property with no attribute, so it is set by hand.
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={box}
      type="checkbox"
      className="select-box"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/** The heading's box over `paths`: ticked when all are chosen, mixed when some are. */
export function SelectAllBox({
  paths,
  selection,
}: {
  paths: readonly string[];
  selection: RowSelection;
}) {
  const chosen = paths.filter((path) => selection.selected.has(path)).length;
  const all = paths.length > 0 && chosen === paths.length;
  return (
    <SelectBox
      label="Select all"
      checked={all}
      mixed={chosen > 0 && !all}
      onChange={() => selection.onToggleAll({ paths, select: !all })}
    />
  );
}

/** Something the chosen rows can have done to them all at once. */
export interface BulkAction {
  readonly label: string;
  readonly onRun: () => void;
  readonly disabled?: boolean;
}

/** Above a list with rows chosen: how many, what can be done to them, and letting go. */
export function SelectionBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: readonly BulkAction[];
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Chosen notes">
      <span className="selection-bar__count" role="status">
        {count === 1 ? '1 selected' : `${count} selected`}
      </span>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="selection-bar__action"
          disabled={action.disabled === true}
          onClick={action.onRun}
        >
          {action.label}
        </button>
      ))}
      <button type="button" className="selection-bar__clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
