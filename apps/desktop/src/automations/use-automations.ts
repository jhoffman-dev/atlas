import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  backoffMinutes,
  dueTrigger,
  isAutomationPath,
  localTimeMs,
  localTimeOf,
  type AutomationRule,
  type LocalTime,
  type LogEntry,
  type RunTrigger,
} from '@atlas/domain';
import {
  adoptAutomations,
  AutomationLogError,
  loadAutomations,
  needsAdoption,
  runAutomation,
  undoLastRun,
  updateAutomation,
  VaultChangedError,
  type ActivityLog,
  type AutomationListing,
  type AutomationPorts,
  type RuleQueryPorts,
  type Clock,
} from '@atlas/application';
import { errorMessage } from '../query/error-message.ts';

/** How often the clock is checked for a rule that has come due, and the rules and logs read again. */
export const SCHEDULE_TICK_MS = 60_000;

export interface AutomationsOptions {
  /** The runner's ports, and the notes on screen, which the page's list and dry run read. */
  readonly ports: AutomationPorts & Pick<RuleQueryPorts, 'notePaths'>;
  readonly clock: Pick<Clock, 'today' | 'localNow'>;
  /** The open vault's root; null with none open. */
  readonly vaultKey: string | null;
  /** Changes when the index does: while the page is open, a rule edited by hand is read again. */
  readonly indexKey: string;
  /** Rules are only run once the index can answer their queries. */
  readonly indexReady: boolean;
  /** Where each run and undo is said (U-28). */
  readonly activity: ActivityLog;
  /** Re-reads the tree and the index once a run or an edit has written. */
  readonly onSettled: () => void;
  /**
   * Whether the Automations page is on screen. Only then is every index change
   * a reason to read the rules and logs again; otherwise the minute's tick is.
   */
  readonly live?: boolean;
  /**
   * Whether the clock runs rules on this Mac. A synced vault names one Mac for
   * its automations (U-29); on any other, rules still run by hand. Left out, it does.
   */
  readonly scheduled?: boolean;
}

/**
 * Why a rule is not being run by the clock just now (A25-01): its log could
 * not be written — so a run would change notes nothing records — until it is
 * run by hand; or it keeps failing, and waits longer each time.
 */
export interface RulePause {
  readonly reason: string;
  readonly failures: number;
  /** When the clock may try it again; null until it is run by hand. */
  readonly retryAt: LocalTime | null;
}

/** The vault's automations as last read, and which vault they were read from. */
interface Read {
  readonly vault: string;
  readonly listing: AutomationListing;
  /** The command count it was read after: older, and a run it has not seen may be missing from it. */
  readonly revision: number;
  /** The tick it was read on: the clock only acts on rules read this minute. */
  readonly tick: number;
}

type Exclusive = <Result>(
  task: (vault: string) => Promise<Result>,
  options?: { wait?: boolean },
) => Promise<Result | null>;

/**
 * The vault's automations, and the one runner that carries them out — on
 * their schedule, when the vault opens, or when asked (P25-02).
 *
 * The timer lives here, at the edge, where the clock is: whether a rule is
 * due is the domain's to say, and what a run does is the use-case's. One run
 * at a time, so a scheduled run never plans against notes a hand-started one
 * is still moving.
 */
export function useAutomations(options: AutomationsOptions) {
  const { ports, clock, vaultKey, onSettled, activity } = options;
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [tick, setTick] = useState(0);
  const pending = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const openVault = useRef(vaultKey);
  openVault.current = vaultKey;
  // When this vault was opened: what a rule with no log counts its first run from.
  const watchingSince = useMemo<LocalTime | null>(
    () => (vaultKey === null ? null : clock.localNow()),
    [vaultKey, clock],
  );
  const pauses = usePauses(vaultKey, clock);

  useListing({ ...options, revision, tick, setRead, setError });

  useEffect(() => {
    if (vaultKey === null) return;
    const timer = setInterval(() => setTick((count) => count + 1), SCHEDULE_TICK_MS);
    return () => clearInterval(timer);
  }, [vaultKey]);

  /**
   * Runs one command on the vault's rules; reads them again after. A command
   * asked for while another is under way is refused — unless it waits its
   * turn, as a save from the editor does, which must never simply vanish.
   */
  const exclusive: Exclusive = useCallback(
    async (task, { wait = false } = {}) => {
      if (openVault.current === null || (pending.current > 0 && !wait)) return null;
      pending.current += 1;
      const previous = queue.current;
      let release = () => {};
      queue.current = new Promise<void>((resolve) => (release = resolve));
      setBusy(true);
      try {
        await previous;
        const vault = openVault.current;
        return vault === null ? null : await task(vault);
      } catch (cause) {
        setNotice(errorMessage(cause));
        return null;
      } finally {
        pending.current -= 1;
        release();
        if (pending.current === 0) setBusy(false);
        setRevision((count) => count + 1);
        onSettled();
      }
    },
    [onSettled],
  );

  const { clear: clearPause, record: recordFailure } = pauses;
  const runRule = useCallback(
    (rule: AutomationRule, trigger: RunTrigger) =>
      exclusive(async (vault) => {
        try {
          const entry = await runAutomation({
            ports,
            rule,
            clock,
            activity,
            trigger,
            guard: { vault, currentVault: () => openVault.current },
          });
          clearPause(rule.id);
          return entry;
        } catch (cause) {
          recordFailure(rule.id, cause);
          throw cause;
        }
      }),
    [exclusive, ports, clock, activity, clearPause, recordFailure],
  );

  const undo = useCallback(
    (rule: AutomationRule) =>
      exclusive((vault) =>
        undoLastRun({
          ports,
          rule,
          clock,
          activity,
          guard: { vault, currentVault: () => openVault.current },
        }),
      ),
    [exclusive, ports, clock, activity],
  );

  const setEnabled = useCallback(
    (rule: AutomationRule, enabled: boolean) =>
      exclusive(() =>
        updateAutomation({
          fs: ports.fs,
          markdown: ports.markdown,
          clock,
          rule,
          draft: { ...rule, enabled },
        }),
      ),
    [exclusive, ports, clock],
  );

  const current = read !== null && read.vault === vaultKey ? read.listing : null;
  // Only rules read this minute, since the last command, are run by the clock: a listing
  // from before a run does not know it ran, and would run it again.
  const fresh = read?.revision === revision && read.tick === tick ? current : null;
  useSchedule({
    ...options,
    listing: fresh,
    tick,
    watchingSince,
    runRule,
    exclusive,
    isPaused: pauses.isPaused,
  });

  return {
    listing: current,
    error,
    busy,
    notice,
    setNotice,
    watchingSince,
    /** Rules the clock is not running just now, by id, and why. */
    pauses: pauses.all,
    /** Runs a rule now, by hand; settles with its log entry, or null when it did not run. */
    runNow: useCallback((rule: AutomationRule) => runRule(rule, 'hand'), [runRule]),
    undo,
    /** Turns a rule on or off, in its file; turning one on is logged, so its schedule counts from then. */
    setEnabled,
    /** Writes to the vault's rules — a save, turning one on — through the same one-at-a-time door. */
    exclusive,
  };
}

/** Paused rules by id, and the vault they were paused in. */
interface VaultPauses {
  readonly vault: string | null;
  readonly byId: ReadonlyMap<string, RulePause>;
}

const NO_PAUSES: ReadonlyMap<string, RulePause> = new Map();

/**
 * The rules the clock has stopped running, kept for the vault open now. They
 * carry their vault: on the render a switch arrives, before any effect has
 * cleared them, the last vault's pauses are not this one's.
 */
function usePauses(vaultKey: string | null, clock: Pick<Clock, 'localNow'>) {
  const [held, setHeld] = useState<VaultPauses>({ vault: vaultKey, byId: NO_PAUSES });
  const all = held.vault === vaultKey ? held.byId : NO_PAUSES;
  const latest = useRef(all);
  latest.current = all;

  // Coming back to a vault starts it afresh, as opening it does.
  useEffect(() => {
    setHeld({ vault: vaultKey, byId: NO_PAUSES });
  }, [vaultKey]);

  const change = useCallback(
    (next: (byId: ReadonlyMap<string, RulePause>) => ReadonlyMap<string, RulePause>) => {
      setHeld((pauses) => ({ vault: pauses.vault, byId: next(pauses.byId) }));
    },
    [],
  );

  const clear = useCallback(
    (id: string) => {
      change((pauses) => {
        if (!pauses.has(id)) return pauses;
        const next = new Map(pauses);
        next.delete(id);
        return next;
      });
    },
    [change],
  );

  const record = useCallback(
    (id: string, cause: unknown) => {
      // Another vault was opened: the run was cut off, and the rule is not at fault.
      if (cause instanceof VaultChangedError) return;
      change((pauses) =>
        new Map(pauses).set(id, pauseAfter(pauses.get(id), cause, clock.localNow())),
      );
    },
    [change, clock],
  );

  const isPaused = useCallback((id: string, now: LocalTime) => {
    const pause = latest.current.get(id);
    return pause !== undefined && (pause.retryAt === null || now < pause.retryAt);
  }, []);

  return { all, clear, record, isPaused };
}

/** A rule's pause after one more failure. */
function pauseAfter(previous: RulePause | undefined, cause: unknown, now: LocalTime): RulePause {
  const failures = (previous?.failures ?? 0) + 1;
  if (cause instanceof AutomationLogError) {
    return {
      reason: `Paused: ${cause.message} Run it by hand to try again.`,
      failures,
      retryAt: null,
    };
  }
  const retryAt = localTimeOf((localTimeMs(now) ?? 0) + backoffMinutes(failures) * 60_000);
  return {
    reason: `Could not run (${errorMessage(cause)}); it is tried again at ${retryAt.slice(11, 16)}.`,
    failures,
    retryAt,
  };
}

/**
 * Reads the vault's rules when the vault, its rule files, a command or the
 * minute changes them — and, while the page is open, whenever the index
 * does. Not on every note saved elsewhere: a vault with many rules would read
 * every rule and every log each time.
 */
function useListing({
  ports,
  vaultKey,
  indexKey,
  live = false,
  revision,
  tick,
  setRead,
  setError,
}: AutomationsOptions & {
  revision: number;
  tick: number;
  setRead: (read: Read | null) => void;
  setError: (error: string | null) => void;
}) {
  const { fs, markdown, notePaths } = ports;
  // Keyed by the rule files alone, so a keystroke in another note reads nothing.
  const rulesKey = notePaths.filter(isAutomationPath).join('\n');
  const liveKey = live ? indexKey : '';
  useEffect(() => {
    if (vaultKey === null) {
      setRead(null);
      return;
    }
    let cancelled = false;
    loadAutomations({ fs, markdown, notePaths: rulesKey === '' ? [] : rulesKey.split('\n') })
      .then((listing) => {
        if (cancelled) return;
        setRead({ vault: vaultKey, listing, revision, tick });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [fs, markdown, rulesKey, vaultKey, liveKey, revision, tick, setRead, setError]);
}

/**
 * Runs every rule that is due: once when a vault's rules are first read with
 * its index ready — a rule that runs on opening, and any schedule missed while
 * Atlas was closed — then on each minute's fresh read. Rules it has not taken
 * in yet are taken in first: given their id, and a first mark to count from.
 */
function useSchedule({
  ports,
  vaultKey,
  indexReady,
  clock,
  listing,
  tick,
  watchingSince,
  runRule,
  exclusive,
  isPaused,
  scheduled = true,
}: AutomationsOptions & {
  listing: AutomationListing | null;
  tick: number;
  watchingSince: LocalTime | null;
  runRule: (rule: AutomationRule, trigger: RunTrigger) => Promise<LogEntry | null>;
  exclusive: Exclusive;
  isPaused: (id: string, now: LocalTime) => boolean;
}) {
  const opened = useRef<string | null>(null);
  const checked = useRef<string | null>(null);
  const { fs, markdown } = ports;

  useEffect(() => {
    if (!scheduled) return;
    if (vaultKey === null || !indexReady || listing === null || watchingSince === null) return;
    const key = `${vaultKey}\n${tick}`;
    if (checked.current === key) return;
    checked.current = key;
    const opening = opened.current !== vaultKey;
    opened.current = vaultKey;
    void (async () => {
      if (needsAdoption(listing, clock.localNow())) {
        await exclusive(() => adoptAutomations({ fs, markdown, clock, listing }));
      }
      for (const { rule, log } of listing.automations) {
        const now = clock.localNow();
        if (isPaused(rule.id, now)) continue;
        const trigger = dueTrigger({ rule, log, now, watchingSince, opening });
        if (trigger !== null) await runRule(rule, trigger);
      }
    })();
  }, [
    vaultKey,
    indexReady,
    listing,
    tick,
    watchingSince,
    clock,
    fs,
    markdown,
    exclusive,
    runRule,
    isPaused,
    scheduled,
  ]);
}
