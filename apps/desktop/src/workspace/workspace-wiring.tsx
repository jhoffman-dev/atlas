import { createContext, useContext } from 'react';
import type { NavigationPlace, VaultPath } from '@atlas/domain';
import type { PageProps } from '../main-route.tsx';
import type { OverlayStore } from '../overlay-store.ts';
import type { PaneContext } from '../panes/note-pane-container.tsx';
import type { RevealStore } from '../panes/reveals.ts';
import type { WorkspaceStore } from './workspace-store.ts';

/**
 * The stores the panes subscribe to, and what a place is called. Made once
 * for the life of the window and never changed, so the frames and the strips
 * that read nothing else are not drawn when the app around them is: a tab
 * switch, a focus change or a pane coming or going is what draws them.
 * `nameOf` is steady and reads the latest names; the strip draws again for a
 * change of note names through the names context, as links do.
 */
export interface WorkspaceStores {
  readonly store: WorkspaceStore;
  readonly reveals: RevealStore;
  readonly overlays: OverlayStore;
  /** What a place is called: a tab's title, and where Back goes. */
  readonly nameOf: (place: NavigationPlace) => string;
}

/** What a note's page can do from its bar and menu, which the app owns. */
export interface NoteTabCommands {
  readonly onRename: (args: { path: VaultPath; name: string }) => void;
  readonly onToggleFavorite: (path: VaultPath) => void;
  readonly onMoveTo: (path: VaultPath) => void;
  readonly onDelete: (path: VaultPath) => void;
  readonly onShowInGraph: (path: VaultPath) => void;
}

/**
 * Everything else the panes need from the app, handed down once rather than
 * through each container's props (tab-model.md, PR A): the context every
 * note pane shares, the pages' props, and what a note's bar can do. `App`
 * assembles it on each of its renders, so only what shows a page reads it;
 * the containers decide nothing with it.
 */
export interface WorkspaceWiring extends WorkspaceStores {
  readonly pane: PaneContext;
  readonly pages: PageProps;
  readonly note: NoteTabCommands;
  /** The way back to a hidden sidebar, given while it is hidden. */
  readonly onShowSidebar: (() => void) | null;
}

const StoresContext = createContext<WorkspaceStores | null>(null);
const WiringContext = createContext<WorkspaceWiring | null>(null);

/** The providers themselves, not a component around them: a provider costs the window no draw. */
export const WorkspaceStoresProvider = StoresContext.Provider;
export const WorkspaceWiringProvider = WiringContext.Provider;

export function useWorkspaceStores(): WorkspaceStores {
  const stores = useContext(StoresContext);
  if (stores === null) throw new Error('The panes are drawn outside their wiring.');
  return stores;
}

export function useWorkspaceWiring(): WorkspaceWiring {
  const wiring = useContext(WiringContext);
  if (wiring === null) throw new Error('The panes are drawn outside their wiring.');
  return wiring;
}
