import { useState } from 'react';
import { isEmptyProperty } from '@dfai/domain';
import type { PropertyRow } from './properties-panel.tsx';

/** The keys whose rows hold nothing, as a fold decides them once per note. */
const emptyKeys = (rows: readonly PropertyRow[]): ReadonlySet<string> =>
  new Set(rows.filter((row) => isEmptyProperty(row.value)).map((row) => row.def.key));

/** The empty rows folded away, and the switch that shows them. */
export interface EmptyFold {
  /** The keys hidden now: none while unfolded. */
  readonly folded: readonly string[];
  /** How many rows the fold holds, shown or not. */
  readonly count: number;
  readonly unfolded: boolean;
  readonly toggle: () => void;
}

/**
 * Brief rule 5, hide empty values, as the aside and the peek's strip both
 * fold them. Which rows the fold hides is decided when the note changes, not
 * on every render: a row cleared while it is being edited stays on screen
 * with its focus, and a property just added is drawn the moment it arrives,
 * empty as it is. A row decided empty that is then filled shows too — the
 * fold hides nothing with a value in it.
 *
 * The caller changes `path` and `rows` together: a new path with the old
 * rows would fold the old note's empties.
 */
export function useEmptyFold(path: string, rows: readonly PropertyRow[]): EmptyFold {
  const [unfolded, setUnfolded] = useState(false);
  const [decided, setDecided] = useState(() => ({ path, keys: emptyKeys(rows) }));
  if (decided.path !== path) {
    // Derived from the note: decided again as it changes, during the render
    // that first sees it (with the rows that came with it), which React
    // re-runs at once with the new state.
    setDecided({ path, keys: emptyKeys(rows) });
    setUnfolded(false);
  }
  const held = rows
    .filter((row) => decided.keys.has(row.def.key) && isEmptyProperty(row.value))
    .map((row) => row.def.key);
  return {
    folded: unfolded ? [] : held,
    count: held.length,
    unfolded,
    toggle: () => setUnfolded((was) => !was),
  };
}
