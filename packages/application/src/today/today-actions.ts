import type { PropertyChanges } from '../query/set-property.ts';

type Properties = Readonly<Record<string, unknown>>;

/** A change the page made is not taken back, because the task no longer says what the page wrote. */
export class ChangedSinceError extends Error {
  constructor() {
    super('This task has changed since, so the change was not undone.');
    this.name = 'ChangedSinceError';
  }
}

/** A change to a task that remembers what it replaced, so it can be taken back. */
export interface UndoableChange {
  /** The change itself, to hand to the write. */
  readonly values: PropertyChanges;
  /**
   * What takes the change back, once it has been written: each key it set,
   * given what it held before — or taken out, if it held nothing. Null until
   * the write has run. The undo refuses with {@link ChangedSinceError} when a
   * key no longer holds what was written, so it never undoes a later edit.
   */
  readonly undo: () => PropertyChanges | null;
}

/**
 * Wraps a change to a task so it can be undone (#111). What the task held is
 * read where the write reads it — the file, or the pane holding it — so there
 * is no second read for it to go stale between. What the task rules add on
 * the way in (a finished task's `completed`) they take away on the way back:
 * a task taken out of Archive loses its day.
 */
export function undoableChange(values: PropertyChanges): UndoableChange {
  let written: { before: Properties; after: Properties } | null = null;
  return {
    values: (properties) => {
      const after = typeof values === 'function' ? values(properties) : values;
      const before = Object.fromEntries(
        Object.keys(after).map((key) => [key, properties[key] ?? null]),
      );
      written = { before, after };
      return after;
    },
    undo: () => {
      if (written === null) return null;
      const { before, after } = written;
      return (properties) => {
        const stillAsWritten = Object.entries(after).every(([key, value]) =>
          sameValue(properties[key] ?? null, value ?? null),
        );
        if (!stillAsWritten) throw new ChangedSinceError();
        return before;
      };
    },
  };
}

/** Whether two frontmatter values say the same thing, however deep they go. */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
