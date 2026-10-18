import {
  linkFragment,
  resolveWikiLinkTarget,
  type NavigationPlace,
  type VaultPath,
} from '@atlas/domain';
import type { OpenHow } from '@atlas/ui';
import { requestReveal, type RevealStore } from '../panes/reveals.ts';
import {
  focusPane,
  openInPane,
  openPlace,
  workspaceNow,
  type WorkspaceStore,
} from './workspace-store.ts';

/**
 * Opens a note from outside the panes — the sidebar, search, a new note —
 * where the click asked: here, in a new tab, or in a split. The one rule
 * every open follows is the domain's (`openInActiveTab`): here means where
 * you are working.
 */
export function openNote(store: WorkspaceStore, path: VaultPath, how: OpenHow = 'here'): void {
  openPlace(store, { kind: 'note', path }, how);
}

/** What following a link needs beside the store. */
export interface LinkFollowing {
  readonly store: WorkspaceStore;
  readonly reveals: RevealStore;
  readonly notePaths: readonly VaultPath[];
  /** Told the problem with a link that leads nowhere, or null once one leads somewhere. */
  readonly onProblem: (message: string | null) => void;
}

/**
 * Follows a wiki link in the pane it was clicked in, never the other one:
 * a link opens where you are reading, so the note beside it is still there
 * to be read against. ⌘-click opens it in a new tab beside this one and
 * ⌘⇧-click beside, in a split, as a sidebar row does (tab-model.md §5.2).
 * `[[Note#^id]]` and `[[Note#Heading]]` open the note there (P26-03);
 * `[[#^id]]`, naming no note, is a place in the note it is in.
 */
export function followLink(
  { store, reveals, notePaths, onProblem }: LinkFollowing,
  {
    pane,
    target,
    heading = null,
    how = 'here',
  }: { pane: number; target: string; heading?: string | null; how?: OpenHow },
): void {
  const fragment = heading === null ? null : linkFragment({ heading });
  const here = placeIn(store, pane);
  const resolved =
    target.trim() === '' && fragment !== null
      ? here?.kind === 'note'
        ? here.path
        : null
      : resolveWikiLinkTarget(target, notePaths);
  if (resolved === null) {
    onProblem(`No note called "${target}"`);
    return;
  }
  onProblem(null);
  const place: NavigationPlace = { kind: 'note', path: resolved };
  if (how === 'here') openInPane(store, { pane, place });
  else {
    // The new tab goes beside the tab the link was clicked in, so that pane takes the focus first.
    focusPane(store, pane);
    openPlace(store, place, how);
  }
  if (fragment === null) return;
  const ws = workspaceNow(store);
  const shown = ws.panes[ws.focused];
  if (shown !== undefined) requestReveal(reveals, { tab: shown.active, path: resolved, fragment });
}

function placeIn(store: WorkspaceStore, pane: number): NavigationPlace | null {
  const held = workspaceNow(store).panes[pane];
  return held?.tabs.find((tab) => tab.id === held.active)?.history.current ?? null;
}
