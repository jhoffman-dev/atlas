import { useCallback } from 'react';
import { loadProfile, saveProfile, type MarkdownPort, type VaultFsPort } from '@atlas/application';
import {
  changeProfile,
  EMPTY_PROFILE,
  type Profile,
  type ProfileChange,
  type ProfileState,
} from '@atlas/domain';
import { useVaultSetting } from '../settings/use-vault-setting.ts';
import { vaultSettingsWriter } from '../settings/vault-settings-writer.ts';

/** Settings → Profile: who uses the vault, and a way to change it. */
export interface ProfileSetting {
  /** The names this vault's settings hold; 'unknown' until they are read, and while they cannot be. */
  readonly profile: ProfileState;
  /** Whether `profile` is what this vault's settings say, rather than unknown until they are read. */
  readonly loaded: boolean;
  /** Changes the fields given, and writes only those that changed. */
  readonly save: (change: ProfileChange) => void;
  /** Why the last save failed, or why the settings note cannot be read. */
  readonly problem: string | null;
}

/** The person's name, as the vault's settings note holds it (ADR-0024). */
export function useProfileSetting({
  fs,
  markdown,
  vaultKey,
  changeKey,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vaultKey: string | null;
  changeKey: string;
}): ProfileSetting {
  const load = useCallback(() => loadProfile({ fs, markdown }), [fs, markdown]);
  const store = useCallback(
    (profile: Profile, previous: Profile | null) =>
      saveProfile({
        settings: vaultSettingsWriter({ fs, markdown }),
        profile,
        // Nothing read yet: only a name the person typed differs from none, so only it is written.
        previous: previous ?? EMPTY_PROFILE,
      }),
    [fs, markdown],
  );
  const {
    value,
    loaded,
    save: saveValue,
    problem,
    unreadable,
  } = useVaultSetting({
    load,
    store,
    vaultKey,
    changeKey,
  });
  const save = useCallback(
    (change: ProfileChange) => saveValue(changeProfile(value ?? EMPTY_PROFILE, change)),
    [saveValue, value],
  );
  return {
    profile: loaded ? (value ?? EMPTY_PROFILE) : 'unknown',
    loaded,
    save,
    problem: problem ?? unreadable,
  };
}
