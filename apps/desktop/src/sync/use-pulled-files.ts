import { useCallback, useMemo, useRef, useState } from 'react';
import { actsOnPulledFiles, type PullStanding } from '@atlas/domain';
import {
  settingsNameThisMac,
  type Clock,
  type MarkdownPort,
  type SleepClockPort,
  type VaultFsPort,
} from '@atlas/application';

/** What the rules of `pull-freshness.ts` judge by, read right before acting. */
export interface PulledFilesReading {
  /** The vault's last pull, as this session knows it; null when none has completed since it opened, or it is not open. */
  readonly standing: PullStanding | null;
  /** The host's time asleep since boot, read now; null when it could not be read, or the standing needs none. */
  readonly asleepNowMs: number | null;
  /** Whether the settings as this Mac holds them now name it (`runsAutomationsHere`). */
  readonly namedNow: boolean;
}

/**
 * The gates of ADR-0035 part 4 for the open vault: whether this Mac may act
 * on what sync brought in. The meeting import, a rule's Claude step and the
 * count of meetings waiting each ask right before they act.
 */
export interface PulledFilesGate {
  /** The open vault's last pull; changes as each pull starts and ends, for whatever waits on one. */
  readonly standing: PullStanding | null;
  /** The standing, the host's sleep counter and the settings held now, for the rules in `pull-freshness.ts`. */
  readonly readNow: (vault: string) => Promise<PulledFilesReading>;
  /** Whether this Mac may run the meeting import or a rule's Claude step on the vault's files now. */
  readonly acts: (vault: string) => Promise<boolean>;
}

/** What the vault's runs of git tell the gates. Each is a no-op for a vault no longer open. */
export interface PullRecorder {
  /** Reads the host's sleep counter as a pull or a look starts; null, said in the console, when it cannot. */
  readonly readAsleep: () => Promise<number | null>;
  /** A pull of the vault has started: nothing acts on its files until it completes. */
  readonly started: (vault: string) => void;
  /**
   * The vault's files hold everything GitHub had when a pull or a look began
   * at this reading of the counter; null when it could not be read, which
   * counts for nothing. Reads the settings the files now hold.
   */
  readonly caughtUp: (vault: string, startedAsleepMs: number | null) => Promise<void>;
  /** What the vault's files hold of GitHub is not known: a pull failed, a look found other Macs' changes, sync was just set up. */
  readonly unknown: (vault: string) => void;
  /** The vault does not sync: it has nothing to wait for. */
  readonly notSynced: (vault: string) => void;
}

/** One vault's standing, kept with the vault it belongs to. */
interface Held {
  readonly vault: string | null;
  readonly standing: PullStanding | null;
}

const NOT_SYNCED: PullStanding = { kind: 'not-synced' };
const PULLING: PullStanding = { kind: 'pulling' };

/**
 * The one record, for the open vault, of the last pull this Mac completed
 * (ADR-0035 part 4). Kept for the vault open now and forgotten when another
 * opens: a vault opened again waits for a pull of its own.
 */
export function usePulledFiles({
  vaultKey,
  sleepClock,
  fs,
  markdown,
  thisMacId,
  namedNow,
  clock,
}: {
  vaultKey: string | null;
  sleepClock: SleepClockPort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  /** This Mac's id; null until it is known. */
  thisMacId: string | null;
  namedNow: boolean;
  clock: Pick<Clock, 'now'>;
}): { gate: PulledFilesGate; pulls: PullRecorder } {
  const [held, setHeld] = useState<Held>({ vault: vaultKey, standing: null });
  // Read by a gate between renders; a vault opened is a new record from the render it opens on.
  const latest = useRef<Held>(held);
  if (latest.current.vault !== vaultKey) latest.current = { vault: vaultKey, standing: null };
  const named = useRef(namedNow);
  named.current = namedNow;

  const stand = useCallback((vault: string, standing: PullStanding | null) => {
    if (latest.current.vault !== vault) return;
    latest.current = { vault, standing };
    setHeld(latest.current);
  }, []);
  const standingOf = useCallback(
    (vault: string) => (latest.current.vault === vault ? latest.current.standing : null),
    [],
  );
  const readAsleep = useCallback(
    () =>
      sleepClock.asleepMs().catch((cause: unknown) => {
        // Nothing then acts on a synced vault's files: the gate never guesses.
        console.error('How long this Mac has slept could not be read:', cause);
        return null;
      }),
    [sleepClock],
  );
  const namedAfterPull = useNamedAfterPull({ fs, markdown, thisMacId });

  const pulls = useMemo<PullRecorder>(
    () => ({
      readAsleep,
      started: (vault) => stand(vault, PULLING),
      caughtUp: async (vault, startedAsleepMs) => {
        const finishedAt = clock.now();
        if (startedAsleepMs === null) return stand(vault, null);
        const namedAfter = await namedAfterPull();
        stand(vault, { kind: 'pulled', startedAsleepMs, finishedAt, namedAfter });
      },
      unknown: (vault) => stand(vault, null),
      notSynced: (vault) => stand(vault, NOT_SYNCED),
    }),
    [readAsleep, stand, namedAfterPull, clock],
  );

  const readNow = useCallback(
    async (vault: string): Promise<PulledFilesReading> => {
      // Only a pull is placed against a sleep: a vault that does not sync is never asked about one.
      const asleepNowMs = standingOf(vault)?.kind === 'pulled' ? await readAsleep() : null;
      return { standing: standingOf(vault), asleepNowMs, namedNow: named.current };
    },
    [standingOf, readAsleep],
  );
  const acts = useCallback(
    async (vault: string) => actsOnPulledFiles(await readNow(vault)),
    [readNow],
  );
  const standing = held.vault === vaultKey ? held.standing : null;
  const gate = useMemo(() => ({ standing, readNow, acts }), [standing, readNow, acts]);
  return { gate, pulls };
}

/**
 * Whether the settings, read from the file once a pull has completed, name
 * this Mac. Settings that cannot be read name no one: nothing acts until they
 * can be (ADR-0035, "Unknown"), and Settings → Sync says they cannot be read.
 */
function useNamedAfterPull({
  fs,
  markdown,
  thisMacId,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  thisMacId: string | null;
}) {
  return useCallback(async () => {
    if (thisMacId === null) return false;
    try {
      return await settingsNameThisMac({ fs, markdown, thisMacId });
    } catch (cause) {
      console.error('The vault’s settings could not be read after a pull:', cause);
      return false;
    }
  }, [fs, markdown, thisMacId]);
}
