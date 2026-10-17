import { useState } from 'react';

/**
 * `value`, or the one an earlier render was given while `same` holds them
 * equal: for a value a parent makes anew on every render — a schema's
 * `kinds`, a list of columns — that is handed to rows drawn with `memo`,
 * which would otherwise all draw again for it (#238).
 *
 * Kept by setting state while rendering, as React allows for a value derived
 * from props: a changed value draws this component once more, and its rows
 * once, with the new one.
 */
export function useSteadyValue<Value>(value: Value, same: (a: Value, b: Value) => boolean): Value {
  const [kept, setKept] = useState(value);
  if (kept === value || same(kept, value)) return kept;
  setKept(value);
  return value;
}

/** Whether two lists hold the same items, in the same order. */
export function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, at) => Object.is(item, b[at]));
}

/** Whether two records hold the same keys with the same values, item for item in a list. */
export function sameEntries(a: object, b: object): boolean {
  // Read as records: only an object's own keys are compared, whatever its type names.
  const before = a as Readonly<Record<string, unknown>>;
  const after = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(before);
  return (
    keys.length === Object.keys(after).length &&
    keys.every((key) => Object.hasOwn(after, key) && sameValue(before[key], after[key]))
  );
}

/** A cell's value compared by what it holds: a list item by item, anything else by identity. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, at) => sameValue(item, b[at]));
  }
  return false;
}
