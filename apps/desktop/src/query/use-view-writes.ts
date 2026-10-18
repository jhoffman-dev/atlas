import { useCallback } from 'react';
import {
  calendarEndKey,
  createVaultPath,
  type ObjectType,
  type StatusProperty,
  type ViewDisplay,
} from '@atlas/domain';
import {
  cardAsMoved,
  cardMoveChanges,
  setNoteProperties,
  TaskRuleRefusedError,
  type ActivityLog,
  type MarkdownPort,
  type PropertyChanges,
  type VaultFsPort,
} from '@atlas/application';
import type { CardMove } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import type { OpenEditors } from '../panes/open-editors.ts';
import { localToday } from '../today.ts';
import { errorMessage } from './error-message.ts';
import type { MoveProperties, WriteProperties } from './use-pending-cards.ts';

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
  today = localToday(),
  ifModified,
}: {
  editors: OpenEditors;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: string;
  values: PropertyChanges;
  /** `YYYY-MM-DD`, for the task rules; the Mac's day unless the caller has a clock of its own. */
  today?: string;
  /**
   * The stamp the caller read the note's file at: a file that has moved on
   * since is refused, not written. A pane holding the note writes what it
   * holds, whatever the file's stamp.
   */
  ifModified?: number;
}): Promise<void> {
  const takenByAPane = await editors.setPropertiesIfOpen({ path: createVaultPath(path), values });
  if (takenByAPane) return;
  await setNoteProperties({
    fs,
    markdown,
    path,
    values,
    today,
    ...(ifModified !== undefined && { ifModified }),
  });
}

/** `writeNoteProperties` for a view's gestures: one the view gives up on is recorded in the Activity log. */
export function useWriteProperties({
  editors,
  fs,
  markdown,
  activity,
}: {
  editors: OpenEditors;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): WriteProperties {
  return useCallback(
    ({ path, values }) => {
      const edit = { activity, write: 'edit', path, refusal: TaskRuleRefusedError } as const;
      return withGiveUpRecorded(edit, () =>
        writeNoteProperties({ editors, fs, markdown, path, values }),
      );
    },
    [editors, fs, markdown, activity],
  );
}

/**
 * `writeNoteProperties` for a view's gestures, which report through the view:
 * a failed one is shown there and recorded in the Activity log.
 */
export function useChangeProperties({
  onChanged,
  onError,
  ...ports
}: Parameters<typeof useWriteProperties>[0] & {
  onChanged: () => void;
  onError: (message: string) => void;
}): ChangeProperties {
  const write = useWriteProperties(ports);
  return useCallback(
    (args) => {
      write(args)
        .then(onChanged)
        .catch((cause: unknown) => onError(errorMessage(cause)));
    },
    [write, onChanged, onError],
  );
}

/** Edits made to the notes a view shows: a cell, a card moved, a date or a bar dragged. */
export function useRowWrites({
  display,
  type,
  groupOptions,
  status,
  changeProperties,
  moveProperties,
}: {
  display: ViewDisplay;
  /** The type the view lists, whose property kinds a moved card's values are written as. */
  type: ObjectType | null;
  groupOptions: readonly string[];
  /** The type's status, whose done option finishes work on a board, by column or by lane. */
  status: StatusProperty | null;
  changeProperties: ChangeProperties;
  /** A card's move, which the board draws at once (#260). */
  moveProperties: MoveProperties;
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
   * not decided here — nor is where the card is drawn until its write is
   * read back (`cardAsMoved`).
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
      const moved = { column, lane, status, columnOptions: groupOptions };
      moveProperties({
        path: move.path,
        values: cardMoveChanges(moved),
        shown: (values) => cardAsMoved({ values, move: moved }),
      });
    },
    [display, type, groupOptions, status, moveProperties],
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
