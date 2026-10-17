import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRowHandles } from '../row-handles.ts';
import { useSteadyCallback } from '../steady-callback.ts';
import type { Clarification, InboxItem, VaultPath } from '@atlas/domain';
import { clarificationOf, rowAfter, type InboxDraft } from './inbox-triage.ts';

/** Clarifies a note; settles true once it is done, false when it was refused. */
export type ClarifyInboxItem = (args: {
  path: VaultPath;
  clarification: Clarification;
}) => Promise<boolean>;

const NOTHING_PICKED: InboxDraft = {};

/**
 * Working through the Inbox a row at a time (#112): which row has the focus,
 * what each task's row holds until Done, and the actions a row offers. The
 * controls call these today; the triage keys (#109) call the same ones.
 *
 * An action that is done moves the focus to the next row, so the list is
 * worked top to bottom without reaching for it; a refused one leaves the
 * focus, and what was picked, where it is. The next row may not be in the
 * DOM — the list is virtualised (#238) — so it is `wanted` until it is drawn.
 */
export function useInboxTriage({
  items,
  onClarify,
}: {
  items: readonly InboxItem[];
  onClarify: ClarifyInboxItem;
}) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, InboxDraft>>>({});
  const [focused, setFocused] = useState<VaultPath | null>(null);
  const order = useMemo(() => items.map((item) => item.path), [items]);
  const handles = useRowHandles(order);
  const { focusRow: focusPlaced, elementOf } = handles;
  // Read when a row is acted on, so the actions stay the same from one list to
  // the next and a row that has not changed is not drawn again (#217).
  const listed = useRef(items);
  useEffect(() => {
    listed.current = items;
  }, [items]);

  // The app makes its callback anew on many of its renders; the rows' actions stay the same.
  const clarify = useSteadyCallback(onClarify);

  const focusRow = useCallback(
    (path: VaultPath) => {
      setFocused(path);
      focusPlaced(path);
    },
    [focusPlaced],
  );

  const act = useCallback(
    async (path: VaultPath, clarification: Clarification) => {
      const next = rowAfter(listed.current, path);
      if (!(await clarify({ path, clarification }))) return;
      setDrafts((held) => Object.fromEntries(Object.entries(held).filter(([at]) => at !== path)));
      // Focus that has gone elsewhere since — another note opened, say — is left there.
      const at = document.activeElement;
      const stillHere = at === document.body || elementOf(path)?.contains(at) === true;
      if (next !== null && stillHere) focusRow(next);
    },
    [clarify, focusRow, elementOf],
  );

  return {
    /** The row the focus is in, or was last in. */
    focused,
    onRowFocus: setFocused,
    /** Registers a row's element, so the focus can be put on it. */
    rowRef: handles.rowRef,
    /** A row to focus that the list has yet to draw: it places it. */
    wanted: handles.wanted,
    draftOf: (path: VaultPath): InboxDraft => drafts[path] ?? NOTHING_PICKED,
    /** Holds a pick on a task's row until Done. */
    pick: useCallback(
      (path: VaultPath, picked: InboxDraft) =>
        setDrafts((held) => ({ ...held, [path]: { ...held[path], ...picked } })),
      [],
    ),
    /** Done: writes everything the task's row holds — `draft` — in one save. */
    commit: useCallback(
      (item: InboxItem, draft: InboxDraft) => {
        const clarification = item.task === null ? null : clarificationOf(item.task, draft);
        if (clarification !== null) void act(item.path, clarification);
      },
      [act],
    ),
    /** Files a note that is not a task under a project or an area, at once. */
    fileUnder: useCallback(
      (path: VaultPath, project: VaultPath) => void act(path, { project }),
      [act],
    ),
    /** Makes a plain note a task, which then waits on its own row to be clarified as one. */
    makeTask: useCallback(
      (path: VaultPath) =>
        void clarify({ path, clarification: { asTask: true } }).then((done) => {
          if (done) focusRow(path);
        }),
      [clarify, focusRow],
    ),
  };
}

export type InboxTriage = ReturnType<typeof useInboxTriage>;
