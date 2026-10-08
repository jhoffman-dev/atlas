import { useCallback } from 'react';
import {
  calendarEndKey,
  createVaultPath,
  type ObjectType,
  type StatusProperty,
  type ViewDisplay,
} from '@atlas/domain';
import {
  cardMoveChanges,
  setNoteProperties,
  type MarkdownPort,
  type PropertyChanges,
  type VaultFsPort,
} from '@atlas/application';
import type { CardMove } from '@atlas/ui';
import type { OpenEditors } from '../panes/open-editors.ts';
import { localToday } from '../today.ts';
import { errorMessage } from './error-message.ts';

/** Writes one note the view shows — a row, a card, or the view note itself. */
export type ChangeProperties = (args: { path: string; values: PropertyChanges }) => void;

/**
 * Writes a note the view is showing — which may be open in a pane.
 *
 * A pane holding the note writes it through its own save, so the pane is not
 * left holding a modification time the file has moved past; only a note no
 * pane has open is written straight to the file.
 */
export async function writeNoteProperties({
  editors,
  fs,
  markdown,
  path,
  values,
}: {
  editors: OpenEditors;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: string;
  values: PropertyChanges;
}): Promise<void> {
  const takenByAPane = await editors.setPropertiesIfOpen({ path: createVaultPath(path), values });
  if (!takenByAPane) await setNoteProperties({ fs, markdown, path, values, today: localToday() });
}

/** `writeNoteProperties` for a view's gestures, which report through the view. */
export function useChangeProperties({
  editors,
  fs,
  markdown,
  onChanged,
  onError,
}: {
  editors: OpenEditors;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  onChanged: () => void;
  onError: (message: string) => void;
}): ChangeProperties {
  return useCallback(
    ({ path, values }) => {
      writeNoteProperties({ editors, fs, markdown, path, values })
        .then(onChanged)
        .catch((cause: unknown) => onError(errorMessage(cause)));
    },
    [editors, fs, markdown, onChanged, onError],
  );
}

/** Edits made to the notes a view shows: a cell, a card moved, a date or a bar dragged. */
export function useRowWrites({
  display,
  type,
  groupOptions,
  status,
  changeProperties,
}: {
  display: ViewDisplay;
  /** The type the view lists, whose property kinds a moved card's values are written as. */
  type: ObjectType | null;
  groupOptions: readonly string[];
  /** The type's status, whose done option finishes work on a board, by column or by lane. */
  status: StatusProperty | null;
  changeProperties: ChangeProperties;
}) {
  const editCell = useCallback(
    ({ path, column, value }: { path: string; column: string; value: string }) => {
      changeProperties({ path, values: { [column]: value === '' ? null : value } });
    },
    [changeProperties],
  );

  /**
   * A card dropped into another column, another lane, or both: each property
   * it left the group of, written as one change. What finishes the task, and
   * how each value is typed, is the application's rule (`cardMoveChanges`),
   * not decided here.
   */
  const moveCard = useCallback(
    (move: CardMove) => {
      const { groupBy, subGroupBy } = display;
      if (groupBy === null) return;
      const kindOf = (key: string) =>
        type?.properties.find((property) => property.key === key)?.kind;
      const column =
        'value' in move ? { key: groupBy, value: move.value, kind: kindOf(groupBy) } : null;
      const lane =
        'lane' in move && subGroupBy !== null
          ? { key: subGroupBy, value: move.lane, kind: kindOf(subGroupBy) }
          : null;
      if (column === null && lane === null) return;
      changeProperties({
        path: move.path,
        values: cardMoveChanges({ column, lane, status, columnOptions: groupOptions }),
      });
    },
    [display, type, groupOptions, status, changeProperties],
  );

  /**
   * Moves a note on a calendar: its date, and its end when the calendar reads
   * one and the move changes it — written as one edit, like a timeline bar.
   */
  const reschedule = useCallback(
    ({ path, start, end }: { path: string; start: string; end: string | null }) => {
      const { dateKey, startKey, endKey } = display;
      if (dateKey === null) return;
      const spanEnd = calendarEndKey({ dateKey, startKey, endKey });
      changeProperties({
        path,
        values: {
          [dateKey]: start,
          ...(spanEnd === null || end === null ? {} : { [spanEnd]: end }),
        },
      });
    },
    [display, changeProperties],
  );

  /**
   * Moves a bar on a timeline: both ends of the work shift together, written as
   * one edit so the note is never briefly half-moved.
   */
  const moveBar = useCallback(
    ({ path, start, end }: { path: string; start: string; end: string }) => {
      if (display.startKey === null) return;
      const endKey = display.endKey ?? display.startKey;
      changeProperties({
        path,
        values:
          endKey === display.startKey
            ? { [display.startKey]: start }
            : { [display.startKey]: start, [endKey]: end },
      });
    },
    [display.startKey, display.endKey, changeProperties],
  );

  return { editCell, moveCard, reschedule, moveBar };
}
