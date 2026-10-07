import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  flattenVaultTree,
  isWithin,
  VAULT_ROOT,
  type VaultEntry,
  type VaultPath,
  type VaultTreeRow,
} from '@atlas/domain';
import {
  listVaultDirectory,
  listVaultNotes,
  openVault,
  restoreVault,
  type VaultFsPort,
  type VaultLocation,
  type VaultLocationStore,
  type VaultPickerPort,
  type VaultWatchPort,
} from '@atlas/application';

export interface VaultPorts {
  fs: VaultFsPort;
  picker: VaultPickerPort;
  store: VaultLocationStore;
  watch: VaultWatchPort;
}

export interface VaultView {
  location: VaultLocation | null;
  rows: readonly VaultTreeRow[];
  /** Every note in the vault, for resolving links and offering completions. */
  notePaths: readonly VaultPath[];
  error: string | null;
  chooseVault: () => void;
  /** Shows a vault another way of opening has already chosen and remembered — a clone from GitHub. */
  showVault: (location: VaultLocation) => void;
  toggleDirectory: (path: VaultPath) => void;
  /** Opens a folder in the tree, if it is not open already: where something was just put. */
  expandDirectory: (path: VaultPath) => void;
  /**
   * Forgets a folder that has moved or gone, and everything under it, so the
   * tree does not go on re-reading a path that is no longer there.
   */
  forgetDirectory: (path: VaultPath) => void;
  /** Whether a folder is open in the tree. */
  isExpanded: (path: VaultPath) => boolean;
  /**
   * Re-reads the directories already on screen, after an outside change, and
   * settles once the tree shows what is on disk.
   */
  reload: () => Promise<void>;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Holds the part of the vault the user has actually looked at: directories are
 * read as they are expanded, never up front, so opening a large vault is instant.
 *
 * What is *open* is not here: the panes hold that, because with a split there
 * is more than one of it and the vault has no opinion about which.
 */
export function useVault(
  { fs, picker, store }: VaultPorts,
  {
    beforeSwitch,
  }: {
    /** Settles the vault being left, once another is chosen and before the host moves. */
    beforeSwitch?: () => Promise<void>;
  } = {},
): VaultView {
  /** Read when a vault is chosen, so the callback need not be stable to be current. */
  const settle = useRef(beforeSwitch);
  settle.current = beforeSwitch;

  const [location, setLocation] = useState<VaultLocation | null>(null);
  const [children, setChildren] = useState<ReadonlyMap<VaultPath, readonly VaultEntry[]>>(
    new Map(),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<VaultPath>>(new Set());
  const [notePaths, setNotePaths] = useState<readonly VaultPath[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Folders forgotten since the last render — moved or deleted — which a
   * reload in the same breath must not try to read: its `children` is a
   * render behind, and still lists them.
   */
  const forgotten = useRef<Set<VaultPath>>(new Set());

  const loadDirectory = useCallback(
    async (path: VaultPath) => {
      try {
        const entries = await listVaultDirectory({ fs, path });
        setChildren((current) => new Map(current).set(path, entries));
      } catch (cause) {
        setError(message(cause));
      }
    },
    [fs],
  );

  const adoptVault = useCallback(
    (next: VaultLocation) => {
      setLocation(next);
      setChildren(new Map());
      forgotten.current.clear();
      setExpanded(new Set());
      setError(null);
      void loadDirectory(VAULT_ROOT);
      listVaultNotes({ fs })
        .then(setNotePaths)
        .catch((cause: unknown) => setError(message(cause)));
    },
    [fs, loadDirectory],
  );

  // Reopen last launch's vault, if there was one.
  useEffect(() => {
    let cancelled = false;
    restoreVault({ store })
      .then((remembered) => {
        if (!cancelled && remembered !== null) adoptVault(remembered);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [store, adoptVault]);

  const chooseVault = useCallback(() => {
    openVault({ picker, store, beforeSwitch: () => settle.current?.() ?? Promise.resolve() })
      .then((chosen) => {
        if (chosen !== null) adoptVault(chosen);
      })
      .catch((cause: unknown) => setError(message(cause)));
  }, [picker, store, adoptVault]);

  const toggleDirectory = useCallback(
    (path: VaultPath) => {
      forgotten.current.delete(path);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      // Read a directory the first time it is opened, and not again. This must
      // stay outside the state updater: React may run an updater more than once,
      // and the read would then happen twice.
      if (!children.has(path)) void loadDirectory(path);
    },
    [children, loadDirectory],
  );

  const expandDirectory = useCallback(
    (path: VaultPath) => {
      if (path === VAULT_ROOT) return;
      forgotten.current.delete(path);
      setExpanded((current) => (current.has(path) ? current : new Set(current).add(path)));
      // Outside the updater, for the reason `toggleDirectory` gives.
      if (!children.has(path)) void loadDirectory(path);
    },
    [children, loadDirectory],
  );

  const forgetDirectory = useCallback((path: VaultPath) => {
    forgotten.current.add(path);
    const gone = (each: VaultPath) => isWithin(each, path);
    setChildren((current) => new Map([...current].filter(([each]) => !gone(each))));
    setExpanded((current) => new Set([...current].filter((each) => !gone(each))));
  }, []);

  const isExpanded = useCallback((path: VaultPath) => expanded.has(path), [expanded]);

  const reload = useCallback(async () => {
    const gone = (path: VaultPath) =>
      [...forgotten.current].some((folder) => isWithin(path, folder));
    const paths = [...children.keys()].filter((path) => !gone(path));
    listVaultNotes({ fs })
      .then(setNotePaths)
      .catch((cause: unknown) => setError(message(cause)));
    const listings = await Promise.allSettled(
      paths.map((path) => listVaultDirectory({ fs, path })),
    );
    // All at once: a note moved between two open folders is in one of them
    // at every render, never in both and never in neither. A folder that
    // could not be read keeps what it showed, and says why.
    setChildren((current) => {
      const next = new Map(current);
      listings.forEach((listing, at) => {
        const path = paths[at];
        if (listing.status === 'fulfilled' && path !== undefined) next.set(path, listing.value);
      });
      return next;
    });
    const failed = listings.find((listing) => listing.status === 'rejected');
    if (failed !== undefined) setError(message(failed.reason));
  }, [children, fs]);

  const rows = useMemo(
    () => flattenVaultTree({ children, expanded, notePaths }),
    [children, expanded, notePaths],
  );

  return {
    location,
    rows,
    notePaths,
    error,
    chooseVault,
    showVault: adoptVault,
    toggleDirectory,
    expandDirectory,
    forgetDirectory,
    isExpanded,
    reload,
  };
}
