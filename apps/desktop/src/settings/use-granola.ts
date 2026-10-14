import { useCallback, useState } from 'react';
import { granolaCountsLine, granolaFailureWords } from '@atlas/domain';
import {
  GranolaError,
  type ExternalLinkPort,
  type GranolaPort,
  type GranolaPullReport,
} from '@atlas/application';
import type { GranolaKeyState, GranolaNoteLine, GranolaView } from '@atlas/ui';
import type { GranolaPullController } from '../granola/use-granola-pull.ts';
import { errorMessage } from '../query/error-message.ts';
import { clockTime } from '../sync/sync-view.ts';

/** Settings → Granola as the card draws it, and what it can ask for. */
export interface GranolaSettingState {
  readonly view: GranolaView;
  /** Hands the key to the host, which keeps it and has Granola check it; it is held nowhere here. */
  readonly saveKey: (key: string) => void;
  readonly forgetKey: () => void;
  readonly syncNow: () => void;
  readonly openNote: (url: string) => void;
}

/** Something said about one vault, kept with the vault it was said of. */
interface Said<T> {
  readonly vault: string;
  readonly value: T;
}

const problemOf = (cause: unknown) =>
  cause instanceof GranolaError ? granolaFailureWords(cause.failure) : errorMessage(cause);

function keyStateOf(pull: GranolaPullController, accepted: boolean): GranolaKeyState {
  const { key } = pull;
  if (key === null) return pull.keyProblem === null ? 'checking' : 'none';
  if (!key.hasKey) return 'none';
  if (key.lastRefusal === 401) return 'refused';
  return accepted ? 'accepted' : 'set';
}

/** The meetings a pull did not write, each once, in the order it met them. */
function notesOf(report: GranolaPullReport): GranolaNoteLine[] {
  return [...report.refused, ...report.skipped, ...report.failed].map(
    ({ id, title, url, problem }) => ({ id, title: title ?? id, url, problem }),
  );
}

/** What the last pull did, for a pull that looked at every note; else null. */
function lastPullOf(report: GranolaPullReport | null): string | null {
  if (report?.ended !== 'pulled') return null;
  return granolaCountsLine({
    written: report.written.length,
    held: report.held,
    refused: report.refused.length,
    skipped: report.skipped.length,
    failed: report.failed.length,
  });
}

/** Why the last pull stopped or failed, in the person's words. */
function pullProblemOf(report: GranolaPullReport | null): string | null {
  return report?.ended === 'stopped' || report?.ended === 'failed' ? report.problem : null;
}

/**
 * Settings → Granola: the key, which passes through `saveKey` to the host and
 * is never kept in React state, and the pull's state from the window's one
 * puller. "Key accepted" is said only of a key Granola has just checked.
 */
export function useGranola({
  port,
  pull,
  vault,
  links,
}: {
  port: GranolaPort;
  pull: GranolaPullController;
  /** The open vault's path, which each call names so a switch refuses it. */
  vault: string | null;
  links: ExternalLinkPort;
}): GranolaSettingState {
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState<string | null>(null);
  const [problem, setProblem] = useState<Said<string> | null>(null);
  const { knowKey } = pull;

  const change = useCallback(
    (at: string, ask: () => Promise<{ hasKey: boolean; lastRefusal: 401 | null }>) => {
      setPending(true);
      setProblem(null);
      ask()
        .then((status) => {
          knowKey(status);
          setAccepted(status.hasKey && status.lastRefusal === null ? at : null);
        })
        .catch((cause: unknown) => setProblem({ vault: at, value: problemOf(cause) }))
        .finally(() => setPending(false));
    },
    [knowKey],
  );

  const report = pull.report;
  const said = problem?.vault === vault ? problem.value : null;
  return {
    view: {
      keyState: keyStateOf(pull, vault !== null && accepted === vault),
      waiting: !pull.ready,
      pulling: pull.pulling,
      lastPull: lastPullOf(report),
      lastPullAt: pull.lastPullAt === null ? null : clockTime(pull.lastPullAt),
      notes: report === null ? [] : notesOf(report),
      problem: said ?? pull.keyProblem ?? pullProblemOf(report),
      pending,
    },
    saveKey: (key) => {
      if (vault !== null) change(vault, () => port.setKey({ vault, key }));
    },
    forgetKey: () => {
      if (vault !== null) change(vault, () => port.forgetKey({ vault }));
    },
    syncNow: pull.syncNow,
    openNote: (url) => {
      links.open(url).catch((cause: unknown) => {
        if (vault !== null) setProblem({ vault, value: errorMessage(cause) });
      });
    },
  };
}
