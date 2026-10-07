import { NAME_PLACEHOLDER } from '@atlas/domain';
import { ProfileSettings } from '@atlas/ui';
import type { ProfileSetting } from './use-profile-setting.ts';

/** Settings → Profile, wired to the vault's settings note. */
export function ProfileSettingsCard({ setting }: { setting: ProfileSetting }) {
  const { profile } = setting;
  const known = profile === 'unknown' ? null : profile;
  return (
    <ProfileSettings
      name={known?.name ?? ''}
      preferredName={known?.preferredName ?? ''}
      placeholder={NAME_PLACEHOLDER}
      problem={setting.problem}
      disabled={known === null}
      onName={(name) => setting.save({ name })}
      onPreferredName={(preferredName) => setting.save({ preferredName })}
    />
  );
}
