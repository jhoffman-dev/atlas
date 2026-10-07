import { parseProfile, profileSettingsChanges, type Profile } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * Who uses the vault, as its settings note says (ADR-0024): kept in the vault
 * so it follows the vault to every Mac it syncs to.
 */
export async function loadProfile(args: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<Profile> {
  return parseProfile(await readVaultSettings(args));
}

/**
 * Writes the names that differ from `previous` (what was read) into the
 * vault's settings, leaving the other key as the file holds it; a blank name
 * is removed, not written empty.
 */
export async function saveProfile({
  settings,
  profile,
  previous,
}: {
  settings: SettingsWriter;
  profile: Profile;
  previous: Profile;
}): Promise<void> {
  await settings.save(profileSettingsChanges(profile, previous));
}
