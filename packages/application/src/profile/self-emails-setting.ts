import {
  ownerAddresses,
  parseProfile,
  parseSelfEmails,
  selfEmailsSettingsChanges,
  type SelfEmails,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * The vault owner's own addresses, as its settings note holds them beside the
 * profile (ADR-0024 amendment): `selfEmails`, or Granola's older key while
 * that holds none. A settings note that cannot be read is an error, not "no
 * addresses", as it is for the profile's name.
 */
export async function loadSelfEmails(args: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<SelfEmails> {
  return parseSelfEmails(await readVaultSettings(args));
}

/** Keeps the owner's addresses as `selfEmails`, removing Granola's older key in the same write; none removes both. */
export async function saveSelfEmails({
  settings,
  emails,
}: {
  settings: SettingsWriter;
  emails: readonly string[];
}): Promise<void> {
  await settings.save(selfEmailsSettingsChanges(emails));
}

/**
 * The addresses to offer as the owner's before any are kept: those of their
 * Person note — the one the profile's name names — as meeting linking reads
 * them. Only a suggestion, for the person to keep or not: nothing reads an
 * address as theirs until it is saved.
 */
export async function suggestSelfEmails({
  settings,
  index,
}: {
  /** The vault's settings, already read: the profile's name is in them. */
  settings: Readonly<Record<string, unknown>>;
  index: Pick<IndexPort, 'query'>;
}): Promise<string[]> {
  const { name } = parseProfile(settings);
  const { people } = await loadLinkDirectory({ index });
  return ownerAddresses(people, name);
}
