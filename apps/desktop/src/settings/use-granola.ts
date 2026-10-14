import { useCallback, useEffect, useState } from 'react';
import { granolaCountsLine, granolaFailureWords, granolaSelfEmailsFromText } from '@atlas/domain';
import {
  GranolaError,
  loadGranolaSettings,
  saveGranolaSelfEmails,
  suggestGranolaSelfEmails,
  type ActivityLog,
  type ExternalLinkPort,
  type GranolaPort,
  type GranolaPullReport,
  type IndexPort,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';
import type { GranolaKeyState, GranolaNoteLine, GranolaView } from '@atlas/ui';
import type { GranolaPullController } from '../granola/use-granola-pull.ts';
import { errorMessage } from '../query/error-message.ts';
import { clockTime } from '../sync/sync-view.ts';
import { useVaultSetting } from './use-vault-setting.ts';
import { vaultSettingsWriter } from './vault-settings-writer.ts';

/** Settings → Granola as the card draws it, and what it can ask for. */
export interface GranolaSettingState {
  readonly view: GranolaView;
  /** Hands the key to the host, which keeps it and has Granola check it; it is held nowhere here. */
  readonly saveKey: (key: string) => void;
  readonly forgetKey: () => void;
  readonly syncNow: () => void;
  readonly openNote: (url: string) => void;
  /** Keeps the addresses as typed as the person's own in Granola, in the vault's settings. */
  readonly saveEmails: (emails: string) => void;
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
 * The person's own addresses in Granola, kept in the vault's settings so
 * every Mac maps a meeting alike (ADR-0034), and those of their Person note
 * to offer while none are kept — looked up only while Settings is open.
 */
function useSelfEmails({
  fs,
  markdown,
  index,
  vault,
  changeKey,
  active,
  activity,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  vault: string | null;
  changeKey: string;
  active: boolean;
  activity: Pick<ActivityLog, 'inOpenVault'>;
}) {
  const load = useCallback(
    async () => (await loadGranolaSettings({ fs, markdown })).selfEmails,
    [fs, markdown],
  );
  const store = useCallback(
    (emails: readonly string[]) =>
      saveGranolaSelfEmails({ settings: vaultSettingsWriter({ fs, markdown }), emails }),
    [fs, markdown],
  );
  const setting = useVaultSetting({ load, store, vaultKey: vault, changeKey, activity });
  const [suggested, setSuggested] = useState<Said<readonly string[]> | null>(null);
  useEffect(() => {
    if (vault === null || !active) return;
    let live = true;
    suggestGranolaSelfEmails({ fs, markdown, index }).then(
      (emails) => live && setSuggested({ vault, value: emails }),
      // Only a suggestion: with none, the field starts empty for the person to fill.
      (cause: unknown) => console.error('The Person note’s addresses could not be read:', cause),
    );
    return () => {
      live = false;
    };
  }, [fs, markdown, index, vault, changeKey, active]);
  const offered = suggested?.vault === vault ? suggested.value : [];
  return {
    kept: (setting.value ?? []).join(', '),
    suggested: offered.length === 0 ? null : offered.join(', '),
    problem: setting.problem ?? setting.unreadable,
    save: (emails: string) => setting.save(granolaSelfEmailsFromText(emails)),
  };
}

/**
 * Settings → Granola: the key, which passes through `saveKey` to the host and
 * is never kept in React state, the person's own addresses, and the pull's
 * state from the window's one puller. "Key accepted" is said only of a key
 * Granola has just checked.
 */
export function useGranola({
  port,
  pull,
  vault,
  links,
  ...settings
}: {
  port: GranolaPort;
  pull: GranolaPullController;
  /** The open vault's path, which each call names so a switch refuses it. */
  vault: string | null;
  links: ExternalLinkPort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  changeKey: string;
  /** True while Settings is open: the Person note's addresses are looked up only then. */
  active: boolean;
  /** Where a save of the vault's setting that fails is recorded. */
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): GranolaSettingState {
  const emails = useSelfEmails({ ...settings, vault });
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
      selfEmails: emails.kept,
      suggestedEmails: emails.suggested,
      problem: said ?? pull.keyProblem ?? emails.problem ?? pullProblemOf(report),
      pending,
    },
    saveKey: (key) => {
      if (vault !== null) change(vault, () => port.setKey({ vault, key }));
    },
    forgetKey: () => {
      if (vault !== null) change(vault, () => port.forgetKey({ vault }));
    },
    syncNow: pull.syncNow,
    saveEmails: emails.save,
    openNote: (url) => {
      links.open(url).catch((cause: unknown) => {
        if (vault !== null) setProblem({ vault, value: errorMessage(cause) });
      });
    },
  };
}
