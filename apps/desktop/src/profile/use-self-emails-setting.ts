import { useCallback, useEffect, useState } from 'react';
import {
  loadSelfEmails,
  saveSelfEmails,
  suggestSelfEmails,
  type ActivityLog,
  type IndexPort,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';
import { selfEmailsFromText, type SelfEmails } from '@atlas/domain';
import type { SelfEmailsView } from '@atlas/ui';
import { useVaultSetting } from '../settings/use-vault-setting.ts';
import { vaultSettingsWriter } from '../settings/vault-settings-writer.ts';

/** Settings → Profile's addresses, and the addresses everything that asks who the owner is reads. */
export interface SelfEmailsSetting {
  /**
   * The owner's addresses as this vault's settings hold them; none until they
   * are read, and none while they cannot be, so nothing is guessed meanwhile.
   */
  readonly emails: readonly string[];
  /**
   * Whether this vault's settings note has answered (read, or found
   * unreadable): until then `emails` is a stand-in, and nothing that asks who
   * the owner is should act on it.
   */
  readonly settled: boolean;
  readonly view: SelfEmailsView;
  /**
   * Keeps the addresses typed as `selfEmails`, settling once the write has:
   * true when they were kept; false when what was typed is not all addresses
   * (the reason in the view, and nothing written) or the write failed (the
   * reason in `problem`).
   */
  readonly save: (typed: string) => Promise<boolean>;
  /** Why the last save failed, or why the settings note cannot be read. */
  readonly problem: string | null;
}

/** Something said about one vault, kept with the vault it was said of. */
interface Said<T> {
  readonly vault: string;
  readonly value: T;
}

const listed = (emails: readonly string[]) => emails.join(', ');

/** None, as one value: a fresh `[]` each render would change everything that depends on it. */
const NO_EMAILS: readonly string[] = Object.freeze([]);

/** Why the addresses the settings hold could not be read, as the card says it; null when they were. */
function unreadableOf(read: SelfEmails | null): string | null {
  if (read === null || read.problem === null) return null;
  return `Your emails in settings could not be read: ${read.problem}`;
}

/**
 * The Person note's addresses for the profile's name, offered while none are
 * in use — looked up only while Settings is open.
 */
function useSuggestedEmails({
  fs,
  markdown,
  index,
  vault,
  changeKey,
  active,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  vault: string | null;
  changeKey: string;
  active: boolean;
}): readonly string[] {
  const [suggested, setSuggested] = useState<Said<readonly string[]> | null>(null);
  useEffect(() => {
    if (vault === null || !active) return;
    let live = true;
    suggestSelfEmails({ fs, markdown, index }).then(
      (emails) => live && setSuggested({ vault, value: emails }),
      // Only a suggestion: with none, the field starts empty for the person to fill.
      (cause: unknown) => console.error('The Person note’s addresses could not be read:', cause),
    );
    return () => {
      live = false;
    };
  }, [fs, markdown, index, vault, changeKey, active]);
  return suggested?.vault === vault ? suggested.value : [];
}

/**
 * The vault owner's own addresses, `selfEmails` in the vault's settings beside
 * the profile's names (ADR-0024 amendment), with Granola's older key read in
 * its place while it holds none.
 */
export function useSelfEmailsSetting({
  fs,
  markdown,
  index,
  vaultKey,
  changeKey,
  active,
  activity,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  vaultKey: string | null;
  changeKey: string;
  /** True while Settings is open: the Person note's addresses are looked up only then. */
  active: boolean;
  /** Where a save that fails is recorded. */
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): SelfEmailsSetting {
  const load = useCallback(() => loadSelfEmails({ fs, markdown }), [fs, markdown]);
  const store = useCallback(
    ({ emails }: SelfEmails) =>
      saveSelfEmails({ settings: vaultSettingsWriter({ fs, markdown }), emails }),
    [fs, markdown],
  );
  const setting = useVaultSetting({ load, store, vaultKey, changeKey, activity });
  const offered = useSuggestedEmails({ fs, markdown, index, vault: vaultKey, changeKey, active });
  const [refused, setRefused] = useState<Said<string> | null>(null);
  const read = setting.loaded ? setting.value : null;
  const kept = read?.source === 'selfEmails' ? read.emails : [];
  const inherited = read?.source === 'granola_self_emails' ? read.emails : [];
  return {
    emails: read?.emails ?? NO_EMAILS,
    settled: setting.answered,
    view: {
      kept: listed(kept),
      inherited: inherited.length === 0 ? null : listed(inherited),
      suggested: offered.length === 0 ? null : listed(offered),
      problem: refused !== null && refused.vault === vaultKey ? refused.value : null,
      unreadable: unreadableOf(read),
      disabled: !setting.loaded,
    },
    problem: setting.problem ?? setting.unreadable,
    save: async (typed) => {
      if (vaultKey === null) return false;
      const reading = selfEmailsFromText(typed);
      setRefused(reading.ok ? null : { vault: vaultKey, value: reading.problem });
      if (!reading.ok) return false;
      const source = reading.emails.length === 0 ? null : 'selfEmails';
      const failed = await setting.write({ emails: reading.emails, source, problem: null });
      return failed === null;
    },
  };
}
