import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { useRowHandles } from '../row-handles.ts';
import { useSteadyCallback } from '../steady-callback.ts';
import {
  GTD_STATUSES,
  triageActionOf,
  type Clarification,
  type GtdStatus,
  type InboxItem,
  type TriageAction,
  type VaultPath,
} from '@atlas/domain';
import { clarificationOf, rowAfter, type InboxDraft } from './inbox-triage.ts';

/** Clarifies a note; settles true once it is done, false when it was refused. */
export type ClarifyInboxItem = (args: {
  path: VaultPath;
  clarification: Clarification;
}) => Promise<boolean>;

const NOTHING_PICKED: InboxDraft = {};

/**
 * Where a key never fires (#307): a field, where the letter is typed; a
 * dialog or a menu, which has the keyboard; anything editable.
 */
const KEYS_SLEEP =
  'input, select, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]';

/** A picker P or T opened: its next pick is written at once rather than held for Done. */
interface ArmedPicker {
  readonly path: VaultPath;
  readonly field: 'project' | 'defer';
}

type PickerElement = HTMLSelectElement | HTMLInputElement;

/**
 * Working through the Inbox a row at a time (#112): which row has the focus,
 * what each task's row holds until Done, and the actions a row offers. The
 * controls call these; the triage keys (#109) call the same ones.
 *
 * An action that is done moves the focus to the next row, so the list is
 * worked top to bottom without reaching for it; a refused one leaves the
 * focus, and what was picked, where it is. The next row may not be in the
 * DOM — the list is virtualised (#238) — so it is `wanted` until it is drawn.
 */
export function useInboxTriage({
  items,
  statuses = GTD_STATUSES,
  onClarify,
}: {
  items: readonly InboxItem[];
  /** The statuses the vault's Task type declares: a key for one it lacks does nothing. */
  statuses?: readonly GtdStatus[];
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
  // The row a key lands on: the one the focus is in, kept where the key
  // handler can read it without being made anew on each render.
  const focusedRow = useRef<VaultPath | null>(null);
  const declared = useRef(statuses);
  declared.current = statuses;
  const armed = useRef<ArmedPicker | null>(null);

  // The app makes its callback anew on many of its renders; the rows' actions stay the same.
  const clarify = useSteadyCallback(onClarify);

  const focusRow = useCallback(
    (path: VaultPath) => {
      setFocused(path);
      focusedRow.current = path;
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

  /** Writes what a picker opened by P or T picked, at once; nothing when it changes nothing. */
  const writePick = useCallback(
    (path: VaultPath, picked: InboxDraft) => {
      const item = listed.current.find((each) => each.path === path);
      if (item === undefined) return;
      if (item.task === null) {
        if (picked.project !== undefined) void act(path, { project: picked.project });
        return;
      }
      const clarification = clarificationOf(item.task, picked);
      if (clarification !== null) void act(path, clarification);
    },
    [act],
  );

  /** One key's action on a row (#109): a status written at once, or a picker opened and armed. */
  const keyAction = useCallback(
    (path: VaultPath, action: TriageAction) => {
      const item = listed.current.find((each) => each.path === path);
      if (item === undefined) return;
      if (action.kind === 'status') {
        if (item.task !== null) void act(path, { status: action.status });
        return;
      }
      const picker = elementOf(path)?.querySelector<PickerElement>(
        `[data-field="${action.field}"]`,
      );
      if (picker === null || picker === undefined || picker.disabled) return;
      armed.current = { path, field: action.field };
      picker.focus();
      openPicker(picker);
    },
    [act, elementOf],
  );

  /** The key handler, on the list rather than each row: a letter on a focused row, never in a field. */
  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!(event.target instanceof Element) || event.target.closest(KEYS_SLEEP) !== null) return;
      const path = focusedRow.current;
      if (path === null) return;
      const action = triageActionOf(event.key, declared.current);
      if (action === null) return;
      event.preventDefault();
      keyAction(path, action);
    },
    [keyAction],
  );

  /** A picker P or T opened and then left without a pick is disarmed: its next pick is held for Done again. */
  const onListBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const left = event.target;
    if (armed.current !== null && left.dataset['field'] === armed.current.field) {
      armed.current = null;
    }
  }, []);

  return {
    /** The row the focus is in, or was last in. */
    focused,
    onRowFocus: useCallback((path: VaultPath) => {
      focusedRow.current = path;
      setFocused(path);
    }, []),
    onListKeyDown,
    onListBlur,
    /** Registers a row's element, so the focus can be put on it. */
    rowRef: handles.rowRef,
    /** A row to focus that the list has yet to draw: it places it. */
    wanted: handles.wanted,
    draftOf: (path: VaultPath): InboxDraft => drafts[path] ?? NOTHING_PICKED,
    /** Holds a pick on a task's row until Done — or writes it at once, from a picker a key opened. */
    pick: useCallback(
      (path: VaultPath, picked: InboxDraft) => {
        const arm = armed.current;
        if (arm !== null && arm.path === path && picked[arm.field] !== undefined) {
          armed.current = null;
          writePick(path, picked);
          return;
        }
        setDrafts((held) => ({ ...held, [path]: { ...held[path], ...picked } }));
      },
      [writePick],
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
    keyAction,
  };
}

/**
 * Opens a native picker as a click on it would. `showPicker` needs a user
 * gesture, which the key or the button is; a browser without it, or a
 * jsdom, leaves the picker focused, where Space or ↓ opens it.
 */
function openPicker(picker: PickerElement): void {
  if (!('showPicker' in picker) || typeof picker.showPicker !== 'function') return;
  try {
    picker.showPicker();
  } catch {
    // Safe to ignore: refused only without a user gesture, and the picker has the focus either way.
  }
}

export type InboxTriage = ReturnType<typeof useInboxTriage>;
