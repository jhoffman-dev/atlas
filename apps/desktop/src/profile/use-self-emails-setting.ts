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
  readonly view: SelfEmailsView;
  /**
   * Keeps the addresses typed as `selfEmails`; false, with the reason in the
   * view, when what was typed is not all addresses, and then nothing is kept.
   */
  readonly save: (typed: string) => boolean;
  /** Why the last save failed, or why the settings note cannot be read. */
  readonly problem: string | null;
}

/** Something said about one vault, kept with the vault it was said of. */
interface Said<T> {
  readonly vault: string;
  readonly value: T;
}

const listed = (emails: readonly string[]) => emails.join(', ');

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
    emails: read?.emails ?? [],
    view: {
      kept: listed(kept),
      inherited: inherited.length === 0 ? null : listed(inherited),
      suggested: offered.length === 0 ? null : listed(offered),
      problem: refused !== null && refused.vault === vaultKey ? refused.value : null,
      unreadable: unreadableOf(read),
      disabled: !setting.loaded,
    },
    problem: setting.problem ?? setting.unreadable,
    save: (typed) => {
      if (vaultKey === null) return false;
      const reading = selfEmailsFromText(typed);
      setRefused(reading.ok ? null : { vault: vaultKey, value: reading.problem });
      if (reading.ok) {
        const source = reading.emails.length === 0 ? null : 'selfEmails';
        setting.save({ emails: reading.emails, source, problem: null });
      }
      return reading.ok;
    },
  };
}
