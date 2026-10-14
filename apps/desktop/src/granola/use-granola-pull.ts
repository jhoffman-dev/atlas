import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { granolaFailureWords, type GranolaPullMode } from '@atlas/domain';
import {
  createGranolaPuller,
  GranolaError,
  loadGranolaSettings,
  type ActivityLog,
  type Clock,
  type GranolaKeyStatus,
  type GranolaPort,
  type GranolaPullRecords,
  type GranolaPullReport,
  type IndexPort,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';
import { errorMessage } from '../query/error-message.ts';

/** How often an open vault is pulled while its settings allow it (`granola_periodic`). */
export const GRANOLA_PULL_INTERVAL_MS = 15 * 60_000;

export interface GranolaPullOptions {
  readonly granola: GranolaPort;
  /** This Mac's record of each vault's pulls. */
  readonly records: GranolaPullRecords;
  /** The open vault's files, notes and index, bound to it. */
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly index: IndexPort;
  /** The open vault's root; null with none open. */
  readonly vaultKey: string | null;
  /** Changes when the vault's files do, so an edit to its settings is read. */
  readonly changeKey: string;
  /** The vaults sync has pulled this session, or found not to sync (ADR-0034). */
  readonly syncedThisSession: ReadonlySet<string>;
  /**
   * Refreshes the index of the open vault; true once it holds the files as
   * they are now. Until then a meeting the import has moved out of
   * `Inbox/Meetings/` on another Mac is not found where it now is.
   */
  readonly catchUpIndex: () => Promise<boolean>;
  readonly clock: Pick<Clock, 'now'>;
  readonly activity: ActivityLog;
  /** Re-reads the tree and the index once a pull has written meetings into the vault. */
  readonly onWrote: () => void;
}

export interface GranolaPullController {
  /** Whether this Mac holds a key for the open vault, and Granola's last word on it; null while asked. */
  readonly key: GranolaKeyStatus | null;
  /** Why whether a key is held could not be asked. */
  readonly keyProblem: string | null;
  /**
   * Whether the open vault may be pulled into: it has synced this session, or
   * does not sync, and the index has caught up with what that sync brought in.
   */
  readonly ready: boolean;
  /** Whether a pull of the open vault is under way. */
  readonly pulling: boolean;
  /** How the last pull of the open vault this session ended. */
  readonly report: GranolaPullReport | null;
  /** When this Mac last finished a pull of the open vault, as its record keeps it. */
  readonly lastPullAt: number | null;
  /** What to tell the person at once: a Sync now that failed, or a key Granola has just refused. */
  readonly toast: string | null;
  readonly dismissToast: () => void;
  readonly syncNow: () => void;
  /** Takes the key's status the host answered a change of key with. */
  readonly knowKey: (status: GranolaKeyStatus) => void;
}

/** What is known of one vault's pulls, kept with the vault it belongs to. */
interface VaultPulls {
  readonly vault: string | null;
  readonly key: GranolaKeyStatus | null;
  readonly keyProblem: string | null;
  /** `granola_periodic` as the settings say; null until they are read. */
  readonly periodic: boolean | null;
  /** Pulls under way: Sync now asked for during another pull runs after it. */
  readonly pulling: number;
  readonly report: GranolaPullReport | null;
  readonly lastPullAt: number | null;
  readonly toast: string | null;
}

const nothingFor = (vault: string | null): VaultPulls => ({
  vault,
  key: null,
  keyProblem: null,
  periodic: null,
  pulling: 0,
  report: null,
  lastPullAt: null,
  toast: null,
});

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const problemOf = (cause: unknown) =>
  cause instanceof GranolaError ? granolaFailureWords(cause.failure) : errorMessage(cause);

/**
 * What a pull that ended should say at once, beside its line in Activity: a
 * key Granola refused, and a Sync now that failed, which the person is
 * waiting on. A pull that started by itself and failed for another reason
 * says so in Activity and on the card only. A refused key is said once,
 * since nothing is pulled by itself with a key Granola refused.
 */
function toastOf(report: GranolaPullReport): string | null {
  if (report.keyRefused) return report.problem;
  const failed = report.ended === 'stopped' || report.ended === 'failed';
  return report.mode === 'sync-now' && failed ? report.problem : null;
}

/**
 * Pulls Granola's meetings into the open vault (ADR-0034): once as it opens,
 * every 15 minutes while its settings allow, and on Sync now — and only once
 * a sync has pulled the vault this session, and while this Mac holds a key
 * Granola has not refused. Sync now asks whatever the key's last answer was.
 * One puller for the window, so a pull of a vault never runs twice at once.
 */
export function useGranolaPull(options: GranolaPullOptions): GranolaPullController {
  const { granola, records, fs, markdown, vaultKey, changeKey } = options;
  const latest = useRef(options);
  latest.current = options;
  const caughtUp = useCaughtUp(options);
  const puller = useMemo(
    () =>
      createGranolaPuller({
        ports: () => {
          const { fs: files, markdown: notes, index, granola: api, records: kept } = latest.current;
          return { fs: files, markdown: notes, index, granola: api, records: kept };
        },
        clock: { now: () => latest.current.clock.now() },
        wait,
        activity: options.activity,
        openVault: () => latest.current.vaultKey,
        syncedThisSession: caughtUp.has,
      }),
    [options.activity, caughtUp.has],
  );

  const [held, setHeld] = useState<VaultPulls>(() => nothingFor(vaultKey));
  const mine = held.vault === vaultKey ? held : nothingFor(vaultKey);
  /** Changes what is known of `vault`, unless another vault has opened since. */
  const update = useCallback(
    (vault: string, change: (known: VaultPulls) => Partial<VaultPulls>) =>
      setHeld((known) => (known.vault === vault ? { ...known, ...change(known) } : known)),
    [],
  );

  const readKey = useCallback(
    (vault: string) =>
      granola.status({ vault }).then(
        (key) => update(vault, () => ({ key, keyProblem: null })),
        (cause: unknown) => update(vault, () => ({ keyProblem: problemOf(cause) })),
      ),
    [granola, update],
  );

  useEffect(() => {
    setHeld({
      ...nothingFor(vaultKey),
      lastPullAt: vaultKey === null ? null : records.read(vaultKey).lastPullAt,
    });
    if (vaultKey !== null) void readKey(vaultKey);
  }, [vaultKey, records, readKey]);

  useEffect(() => {
    if (vaultKey === null) return;
    loadGranolaSettings({ fs, markdown }).then(
      ({ periodic }) => update(vaultKey, () => ({ periodic })),
      (cause: unknown) => {
        // The pull reads the settings too, and records in Activity why it could not.
        console.error('The vault’s Granola settings could not be read:', cause);
        update(vaultKey, () => ({ periodic: null }));
      },
    );
  }, [fs, markdown, vaultKey, changeKey, update]);

  const pull = useCallback(
    async (mode: GranolaPullMode) => {
      const vault = latest.current.vaultKey;
      if (vault === null) return;
      update(vault, (known) => ({ pulling: known.pulling + 1 }));
      const report = await puller.pull({ vault, mode });
      if (report.written.length > 0 && latest.current.vaultKey === vault) latest.current.onWrote();
      update(vault, (known) => ({
        pulling: known.pulling - 1,
        report,
        lastPullAt: latest.current.records.read(vault).lastPullAt,
        toast: toastOf(report) ?? known.toast,
      }));
      await readKey(vault);
    },
    [puller, update, readKey],
  );

  const ready = vaultKey !== null && caughtUp.vaults.has(vaultKey);
  const usable = mine.key?.hasKey === true && mine.key.lastRefusal === null;
  const periodic = mine.periodic === true;

  useEffect(() => {
    if (ready && usable) void pull('startup');
  }, [vaultKey, ready, usable, pull]);

  useEffect(() => {
    if (!ready || !usable || !periodic) return;
    const timer = window.setInterval(() => void pull('periodic'), GRANOLA_PULL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [vaultKey, ready, usable, periodic, pull]);

  return {
    key: mine.key,
    keyProblem: mine.keyProblem,
    ready,
    pulling: mine.pulling > 0,
    report: mine.report,
    lastPullAt: mine.lastPullAt,
    toast: mine.toast,
    dismissToast: useCallback(() => {
      if (vaultKey !== null) update(vaultKey, () => ({ toast: null }));
    }, [vaultKey, update]),
    syncNow: useCallback(() => void pull('sync-now'), [pull]),
    knowKey: useCallback(
      (key: GranolaKeyStatus) => {
        if (vaultKey !== null) update(vaultKey, () => ({ key, keyProblem: null }));
      },
      [vaultKey, update],
    ),
  };
}

/**
 * The vaults whose index has caught up after their first sync this session
 * (ADR-0034): once sync has pulled a vault, or found it does not sync, the
 * index is refreshed, and the vault is ready when that refresh has finished.
 * A refresh that fails leaves it waiting, and says why in Activity; the
 * vault opened again tries again.
 */
function useCaughtUp({
  vaultKey,
  syncedThisSession,
  catchUpIndex,
}: Pick<GranolaPullOptions, 'vaultKey' | 'syncedThisSession' | 'catchUpIndex'>) {
  const [vaults, setVaults] = useState<ReadonlySet<string>>(() => new Set());
  // Read by the puller as it starts, so it never waits for a render.
  const current = useRef(vaults);
  const catching = useRef<string | null>(null);
  const synced = vaultKey !== null && syncedThisSession.has(vaultKey);
  useEffect(() => {
    if (vaultKey === null || !synced || current.current.has(vaultKey)) return;
    if (catching.current === vaultKey) return;
    catching.current = vaultKey;
    void catchUpIndex().then((held) => {
      if (catching.current === vaultKey) catching.current = null;
      if (!held) return;
      current.current = new Set([...current.current, vaultKey]);
      setVaults(current.current);
    });
  }, [vaultKey, synced, catchUpIndex]);
  const has = useCallback((vault: string) => current.current.has(vault), []);
  return { vaults, has };
}
