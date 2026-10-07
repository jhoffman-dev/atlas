import { useCallback, useRef, useState } from 'react';
import {
  closeInPaneHistories,
  closePane,
  closePaneHistory,
  followMoveInHistory,
  freshHistories,
  splitHistories,
  withHistory,
  focusPane,
  openBeside as openLayoutBeside,
  isSplit,
  openInFocused,
  openInPane as openLayoutInPane,
  closeInPanes,
  moveInPanes,
  splitPane,
  MAX_PANES,
  SINGLE_PANE,
  type EntryMove,
  type NavigationHistory,
  type PaneHistories,
  type PaneLayout,
  type VaultPath,
} from '@atlas/domain';

/**
 * Where a viewer's split is remembered.
 *
 * Per-viewer, so not in the vault: how the window was arranged says nothing
 * about the notes, and two people opening the same vault do not owe each other
 * a layout. It is still I/O, so this is a port and the composition root hands
 * over the browser one.
 */
export interface PaneLayoutStore {
  /** `null` when this vault has no remembered split, which is not an error. */
  read: (vaultKey: string) => PaneLayout | null;
  write: (args: { vaultKey: string; layout: PaneLayout }) => void;
}

export interface PanesView {
  readonly layout: PaneLayout;
  /**
   * One key per pane, in the layout's order, that stays with the pane while it
   * is open. A pane's place changes when the one before it closes; React keys
   * the panes by these so the pane that is left keeps its editor and its typing.
   */
  readonly keys: readonly number[];
  /** Opens a note where the person is working — the rule every open follows. */
  readonly openInFocusedPane: (path: VaultPath | null) => void;
  /** Opens a note in one named pane, and focuses it: a link followed inside it. */
  readonly openInPane: (args: { pane: number; path: VaultPath }) => void;
  /** Opens a note beside the one being read, splitting the window if it is not. */
  readonly openBeside: (path: VaultPath) => void;
  readonly focus: (pane: number) => void;
  /** Splits this pane — its bar's button; does nothing once there is no room. */
  readonly split: (pane: number) => void;
  /** Splits, or closes the focused pane when the window is already split. */
  readonly toggleSplit: () => void;
  readonly close: (pane: number) => void;
  /** Follows a move or a rename: every pane on a moved note holds it where it went. */
  readonly followMove: (move: EntryMove) => void;
  /** Closes every pane holding one of these notes, which are gone. */
  readonly closeNotes: (paths: readonly VaultPath[]) => void;
  /** Each pane's Back and Forward, kept in line with the panes as they split and close. */
  readonly histories: PaneHistories;
  /** Replaces one pane's history: a visit recorded, or a step back or forward. */
  readonly setHistory: (args: { pane: number; history: NavigationHistory }) => void;
}

/**
 * A key for each pane of a layout that has just been opened. A pane added later
 * is keyed from `MAX_PANES` up, so it never shares a key with one of these.
 */
const freshKeys = (layout: PaneLayout): number[] => layout.paths.map((_, pane) => pane);

/**
 * The key of the pane at this place in the layout. `keys` holds one per pane,
 * changed in the same event as the layout, so the fallback is for the index
 * type only: a place the layout has always has a key.
 */
export function paneKey(keys: readonly number[], pane: number): number {
  return keys[pane] ?? pane;
}

/** The split remembered for a vault, or one empty pane when there is none or no vault. */
function rememberedIn(store: PaneLayoutStore, vaultKey: string | null): PaneLayout {
  return vaultKey === null ? SINGLE_PANE : (store.read(vaultKey) ?? SINGLE_PANE);
}

/**
 * The split, remembered per vault.
 *
 * The rules themselves are in the domain; this holds the current layout, reads
 * the remembered one when a vault opens, and writes every change back.
 */
export function usePanes({
  store,
  vaultKey,
}: {
  store: PaneLayoutStore;
  vaultKey: string | null;
}): PanesView {
  const [loadedFor, setLoadedFor] = useState(vaultKey);
  const [heldLayout, setLayout] = useState<PaneLayout>(() => rememberedIn(store, vaultKey));
  const [heldHistories, setHistories] = useState<PaneHistories>(() => freshHistories(heldLayout));
  const [heldKeys, setKeys] = useState<readonly number[]>(() => freshKeys(heldLayout));
  /**
   * The next new pane's key. Never handed out twice: a save from a pane that
   * has closed lands after it is gone and names its key, so a new pane given
   * the same key would be taken for the pane that wrote and not re-read.
   */
  const nextKey = useRef(MAX_PANES);
  const addKey = useCallback(() => {
    const added = nextKey.current;
    nextKey.current += 1;
    setKeys((was) => [...was, added]);
  }, []);

  // The paths belong to a vault, so the split arrives with one and goes when it
  // does rather than being carried into whatever is opened next. So does where
  // Back leads: another vault's notes are not there to go back to. Read in the
  // render that sees the new vault, not in an effect after it: an effect leaves
  // one render with the old vault's paths under the new vault's key, and R14-01
  // found a race living in exactly that render.
  let layout = heldLayout;
  let histories = heldHistories;
  let keys = heldKeys;
  if (loadedFor !== vaultKey) {
    layout = rememberedIn(store, vaultKey);
    histories = freshHistories(layout);
    keys = freshKeys(layout);
    setLoadedFor(vaultKey);
    setLayout(layout);
    setHistories(histories);
    setKeys(keys);
  }

  const apply = useCallback(
    (change: (was: PaneLayout) => PaneLayout) => {
      const next = change(layout);
      if (next === layout) return;
      // Outside a state updater on purpose: React may run an updater twice, and
      // the write would then happen twice.
      if (vaultKey !== null) store.write({ vaultKey, layout: next });
      setLayout(next);
    },
    [layout, store, vaultKey],
  );

  const openInFocusedPane = useCallback(
    (path: VaultPath | null) => apply((was) => openInFocused(was, path)),
    [apply],
  );

  const openInPane = useCallback(
    ({ pane, path }: { pane: number; path: VaultPath }) =>
      // One rule rather than two: focusing a pane that is not there did
      // nothing, and the open then landed in whichever pane had the focus —
      // replacing the note being read. The domain refuses it outright.
      apply((was) => openLayoutInPane(was, { pane, path })),
    [apply],
  );

  const openBeside = useCallback(
    (path: VaultPath) => {
      if (!isSplit(layout)) {
        setHistories((was) => splitHistories(was, layout));
        addKey();
      }
      apply((was) => openLayoutBeside(was, path));
    },
    [addKey, apply, layout],
  );

  const focus = useCallback((pane: number) => apply((was) => focusPane(was, pane)), [apply]);

  const close = useCallback(
    (pane: number) => {
      // Set beside the layout, in the same event, so no render sees one
      // pane's history drawn on the other.
      setHistories((was) => closePaneHistory(was, pane));
      if (closePane(layout, pane) !== layout) setKeys((was) => was.filter((_, at) => at !== pane));
      apply((was) => closePane(was, pane));
    },
    [apply, layout],
  );

  const split = useCallback(
    (pane: number) => {
      setHistories((was) => splitHistories(was, layout));
      if (splitPane(layout, pane) !== layout) addKey();
      apply((was) => splitPane(was, pane));
    },
    [addKey, apply, layout],
  );

  const toggleSplit = useCallback(() => {
    if (isSplit(layout)) close(layout.focused);
    else split(layout.focused);
  }, [close, layout, split]);

  const followMove = useCallback(
    (move: EntryMove) => {
      setHistories((was) => was.map((history) => followMoveInHistory(history, move)));
      apply((was) => moveInPanes(was, move));
    },
    [apply],
  );

  const closeNotes = useCallback(
    (paths: readonly VaultPath[]) => {
      const gone = new Set<string>(paths);
      const isGone = (held: VaultPath) => gone.has(held);
      const holdsGone = (held: VaultPath | null) => held !== null && isGone(held);
      setHistories((was) => closeInPaneHistories(was, { layout, gone: isGone }));
      if (closeInPanes(layout, isGone) !== layout) {
        setKeys((was) => {
          const kept = was.filter((_, at) => !holdsGone(layout.paths[at] ?? null));
          // Every pane was on a gone note: one empty pane is left, as the first.
          return kept.length > 0 ? kept : was.slice(0, 1);
        });
      }
      apply((was) => closeInPanes(was, isGone));
    },
    [apply, layout],
  );

  const setHistory = useCallback(
    ({ pane, history }: { pane: number; history: NavigationHistory }) =>
      setHistories((was) => withHistory(was, { pane, history })),
    [],
  );

  return {
    layout,
    keys,
    openInFocusedPane,
    openInPane,
    openBeside,
    focus,
    split,
    toggleSplit,
    close,
    followMove,
    closeNotes,
    histories,
    setHistory,
  };
}
