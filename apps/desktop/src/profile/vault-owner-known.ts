import type { ProfileSetting } from './use-profile-setting.ts';
import type { SelfEmailsSetting } from './use-self-emails-setting.ts';

/**
 * Whether who the vault's owner is has been read: the profile's name from a
 * settings note that could be read, and the owner's addresses settled (#173).
 * A settings note found unreadable has answered, but said nothing, so the
 * owner is not known: nothing that asks who they are acts on the stand-in
 * (#226) — not the meeting import, the automations, nor the offered cleanup.
 */
export function vaultOwnerKnown(
  profile: Pick<ProfileSetting, 'loaded' | 'settled'>,
  emails: Pick<SelfEmailsSetting, 'settled'>,
): boolean {
  return profile.settled && profile.loaded && emails.settled;
}
