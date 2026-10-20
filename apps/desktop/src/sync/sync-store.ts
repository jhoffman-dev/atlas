import { useMemo } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { shallow } from 'zustand/shallow';
import { useShallow } from 'zustand/react/shallow';
import type { SyncController } from './use-sync.ts';
import type { PulledFilesGate } from './use-pulled-files.ts';
import { syncConflictNotice, syncIndicatorBadge } from './sync-view.ts';

/**
 * Where the open vault's sync stands, as its runner (`SyncRunner`) last said
 * (#326). The runner holds the sync; the window and the panes read from here
 * only the parts they show or act on, so a sync's phases draw the sync light
 * and Settings → Sync, not the whole window.
 */
export interface SyncState {
  /** Null until the runner has drawn once: nothing about sync is known yet. */
  readonly controller: SyncController | null;
}

export type SyncStore = StoreApi<SyncState>;

export function createSyncStore(): SyncStore {
  return createStore<SyncState>()(() => ({ controller: null }));
}

/**
 * Before the runner has said anything, no pull has happened, and nothing may
 * act on what one brought in: the gate stays shut until the real one replaces it.
 */
const NO_PULL_YET: PulledFilesGate = { standing: null, acts: async () => false };
const NONE_SYNCED: ReadonlySet<string> = new Set();
const NO_PULLS: ReadonlyMap<string, number> = new Map();

/** What the window draws from sync: what Granola waits on, and the conflict warning. */
export interface SyncForWindow {
  readonly syncedThisSession: ReadonlySet<string>;
  readonly syncPulls: ReadonlyMap<string, number>;
  /** The warning after a sync that could not keep a file in one place; null otherwise. */
  readonly conflict: string | null;
}

/** The parts of sync the window reads, drawn again only when one of them changes. */
export function useSyncForWindow(store: SyncStore): SyncForWindow {
  return useStore(
    store,
    useShallow(({ controller }) => ({
      syncedThisSession: controller?.syncedThisSession ?? NONE_SYNCED,
      syncPulls: controller?.syncPulls ?? NO_PULLS,
      conflict: controller === null ? null : syncConflictNotice(controller.phase),
    })),
  );
}

/**
 * What the controllers that act on the vault's files take from sync — the
 * automations and the meeting import: whether this Mac runs them, and the
 * gate on what a pull brought in (ADR-0035 part 4). Each reads it from the
 * store itself, so a change here draws them and not the window.
 */
export interface SyncForRunners {
  /** Whether the clock runs this vault's automations on this Mac. */
  readonly automationsHere: boolean;
  /** Whether this Mac's id and the vault's sync settings are both known yet. */
  readonly macKnown: boolean;
  readonly pulledFiles: PulledFilesGate;
}

/**
 * The parts of sync a runner acts on. The pull gate is the reader's own, made
 * again only when a pull moves its standing: its `acts` asks the runner's
 * gate as it stands at the time, so a new vault's gate, standing as the last
 * did, draws nothing.
 */
export function useSyncForRunners(store: SyncStore): SyncForRunners {
  const { standing, ...facts } = useStore(
    store,
    useShallow(({ controller }) => ({
      automationsHere: controller?.automationsHere ?? false,
      macKnown: controller !== null && controller.thisMac !== null && controller.settings !== null,
      standing: controller?.pulledFiles.standing ?? null,
    })),
  );
  const pulledFiles = useMemo<PulledFilesGate>(
    () => ({
      standing,
      acts: (vault, arrival) =>
        (store.getState().controller?.pulledFiles ?? NO_PULL_YET).acts(vault, arrival),
    }),
    [store, standing],
  );
  return { ...facts, pulledFiles };
}

/**
 * Says where sync stands, as the runner draws it. `useSync` hands back a new
 * object each draw; one whose every part is as it was says nothing, so what
 * reads the store is not drawn for a runner drawn with the window.
 */
export function publishSync(store: SyncStore, controller: SyncController | null): void {
  store.setState((was) => (shallow(was.controller, controller) ? was : { controller }));
}

/** The sidebar's sync light, or null for a vault that does not sync: drawn only when it changes. */
export function useSyncBadge(store: SyncStore): ReturnType<typeof syncIndicatorBadge> | null {
  const facts = useStore(
    store,
    useShallow(({ controller }) =>
      controller === null
        ? null
        : { phase: controller.phase, behind: controller.behind, paused: controller.paused },
    ),
  );
  return useMemo(() => (facts === null ? null : syncIndicatorBadge(facts)), [facts]);
}

/** The whole sync, for what shows all of it: the sync light and Settings → Sync. */
export function useSyncController(store: SyncStore): SyncController | null {
  return useStore(store, (state) => state.controller);
}

/** Settles once any sync under way has finished; at once when there is none to wait for. */
export function settleSync(store: SyncStore): Promise<void> {
  return store.getState().controller?.settle() ?? Promise.resolve();
}
