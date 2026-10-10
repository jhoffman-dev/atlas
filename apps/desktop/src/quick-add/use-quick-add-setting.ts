import { useCallback } from 'react';
import {
  loadQuickAddSetting,
  saveQuickAddSetting,
  type ActivityLog,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';
import { useVaultSetting } from '../settings/use-vault-setting.ts';
import { vaultSettingsWriter } from '../settings/vault-settings-writer.ts';

/** The vault's quick-add setting: the types it lists, and a way to change them. */
export interface QuickAddSetting {
  /** The listed type names; null when the vault's settings say nothing. */
  readonly configured: readonly string[] | null;
  readonly save: (types: readonly string[]) => void;
  /** Why the last save failed, or why the settings note cannot be read. */
  readonly problem: string | null;
}

/** Which types the add button offers, as the vault's settings note lists them. */
export function useQuickAddSetting({
  fs,
  markdown,
  vaultKey,
  changeKey,
  activity,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vaultKey: string | null;
  changeKey: string;
  /** Where a save that fails is recorded. */
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): QuickAddSetting {
  const load = useCallback(() => loadQuickAddSetting({ fs, markdown }), [fs, markdown]);
  const store = useCallback(
    (types: readonly string[]) =>
      saveQuickAddSetting({ settings: vaultSettingsWriter({ fs, markdown }), types }),
    [fs, markdown],
  );
  const { value, save, problem, unreadable } = useVaultSetting({
    load,
    store,
    vaultKey,
    changeKey,
    activity,
  });
  // A settings note that cannot be read is said so here, rather than the
  // default types being offered as if they were what the vault chose.
  return { configured: value, save, problem: problem ?? unreadable };
}
