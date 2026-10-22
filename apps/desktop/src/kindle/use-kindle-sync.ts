import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KINDLE_AUTO_SYNC_INTERVAL_MS,
  kindleAutoSyncHeldUntil,
  type KindleSyncRecord,
} from '@dfai/domain';
import {
  connectKindle,
  disconnectKindle,
  literatureNoteKindleSink,
  runKindleSync,
  type Clock,
  type IndexPort,
  type KindleDelay,
  type KindleNotebookSource,
  type KindleSession,
  type KindleSync,
  type KindleSyncRecords,
  type KindleSyncRun,
  type KindleSyncWhy,
  type LiteratureNoteWritePorts,
  type MarkdownPort,
  type Rng,
  type VaultFsPort,
} from '@dfai/application';
import { useSteadyCallback, type KindleBusy, type KindleView } from '@dfai/ui';
import { errorMessage } from '../query/error-message.ts';

/** Kindle, through the host (ADR-0044), and this app's one sync of it. */
export interface KindleHost {
  readonly notebook: KindleNotebookSource;
  readonly session: KindleSession;
  /** The app's one `createKindleSync`: launch, the schedule, Settings and ⌘K all use it. */
  readonly sync: KindleSync;
  /** The real wait between two fetches. */
  readonly delay: KindleDelay;
  /** This Mac's record of Kindle sync, outside the vault. */
  readonly records: KindleSyncRecords;
}

export interface KindleWindowOptions {
  readonly kindle: KindleHost;
  /** The open vault's files, notes, index and panes, bound to it. */
  readonly fs: VaultFsPort;
  readonly markdown: LiteratureNoteWritePorts['markdown'] &
    Pick<MarkdownPort, 'frontmatterProperties'>;
  readonly index: Pick<IndexPort, 'notesOfType'>;
  readonly openNotes: LiteratureNoteWritePorts['openNotes'];
  readonly rng: Rng;
  readonly clock: Pick<Clock, 'now' | 'today'>;
  /** The open vault's root; null with none open. */
  readonly vaultKey: string | null;
  /** Whether the index holds the vault as it is: the literature notes are looked up in it. */
  readonly indexReady: boolean;
  /** Re-reads the tree and the index once a sync has written into the vault. */
  readonly onWrote: () => void;
}

export interface KindleController {
  readonly view: KindleView;
  readonly connect: () => void;
  readonly syncNow: () => void;
  readonly disconnect: () => void;
  /** What a sync the person asked for said; null when nothing is to be said. */
  readonly toast: string | null;
  /** How many toasts have been shown: the Toast's `key`. */
  readonly toastShown: number;
  readonly dismissToast: (shown: number) => void;
}

/** A time as this Mac's clock shows it: the day, and the time to the minute. */
const kindleTime = (at: number): string =>
  new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** Settings → Kindle's view of the record, and what is under way. */
function viewOf(
  record: KindleSyncRecord,
  state: { busy: KindleBusy | null; problem: string | null; now: number },
): KindleView {
  const heldUntil = kindleAutoSyncHeldUntil(record.lastHoldAt);
  return {
    connected: record.connected,
    busy: state.busy,
    last: record.last === null ? null : { ...record.last, at: kindleTime(record.last.at) },
    heldUntil: heldUntil !== null && heldUntil > state.now ? kindleTime(heldUntil) : null,
    problem: state.problem,
  };
}

/**
 * Kindle sync for the window (#508): once the open vault's index is ready,
 * then every four hours while the vault is open, each automatic try left to
 * `runKindleSync` (connected, not held, not just synced); Connect, Sync now
 * and Disconnect for Settings and ⌘K. An automatic try that does not run
 * changes nothing on screen.
 */
export function useKindleSync(options: KindleWindowOptions): KindleController {
  const { kindle, fs, markdown, index, openNotes, rng, clock, vaultKey, indexReady } = options;
  const [record, setRecord] = useState(() => kindle.records.read());
  const [busy, setBusy] = useState<KindleBusy | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // `shown` counts every toast, so the same words again start the Toast's time afresh.
  const [toast, setToast] = useState<{ message: string | null; shown: number }>({
    message: null,
    shown: 0,
  });
  const sink = useMemo(
    () => literatureNoteKindleSink({ fs, markdown, index, openNotes, rng, clock }),
    [fs, markdown, index, openNotes, rng, clock],
  );
  const runPorts = useMemo(
    () => ({
      sync: kindle.sync,
      records: kindle.records,
      ports: { source: kindle.notebook, sink, clock, delay: kindle.delay },
    }),
    [kindle, sink, clock],
  );

  const settled = useSteadyCallback((run: KindleSyncRun, told: boolean) => {
    if (run.kind === 'skipped') return;
    setRecord(run.record);
    if (run.kind === 'ran' && run.report.kind !== 'unrecognised' && run.report.added > 0) {
      options.onWrote();
    }
    const said = run.record.last?.message;
    if (told && said !== undefined) setToast(({ shown }) => ({ message: said, shown: shown + 1 }));
  });

  const run = useSteadyCallback(async (why: KindleSyncWhy) => {
    if (why === 'asked') setBusy('syncing');
    try {
      settled(await runKindleSync(runPorts, why), why === 'asked');
    } finally {
      if (why === 'asked') setBusy(null);
    }
  });

  useEffect(() => {
    if (vaultKey === null || !indexReady) return undefined;
    void run('automatic');
    const timer = window.setInterval(() => void run('automatic'), KINDLE_AUTO_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [vaultKey, indexReady, run]);

  const connect = useSteadyCallback(async () => {
    setBusy('connecting');
    setProblem(null);
    try {
      setRecord(await connectKindle({ session: kindle.session, records: kindle.records }));
      setBusy('syncing');
      settled(await runKindleSync(runPorts, 'asked'), true);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(null);
    }
  });

  const disconnect = useSteadyCallback(async () => {
    setBusy('disconnecting');
    setProblem(null);
    try {
      setRecord(await disconnectKindle({ session: kindle.session, records: kindle.records }));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(null);
    }
  });

  const dismissToast = useCallback(
    (shown: number) =>
      setToast((now) => (now.shown === shown ? { message: null, shown: now.shown } : now)),
    [],
  );

  return {
    view: viewOf(record, { busy, problem, now: clock.now() }),
    connect: () => void connect(),
    syncNow: () => void run('asked'),
    disconnect: () => void disconnect(),
    toast: toast.message,
    toastShown: toast.shown,
    dismissToast,
  };
}
