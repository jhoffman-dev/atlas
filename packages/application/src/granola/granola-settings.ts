import {
  GRANOLA_SELF_EMAILS_KEY,
  ownerAddresses,
  parseGranolaSettings,
  parseProfile,
  type GranolaSettings,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * What the vault's settings note says about Granola: among it everything the
 * mapper is told besides the note — the zone, the group addresses and the
 * person's own addresses — so that every Mac maps a note into the same bytes
 * (ADR-0034).
 */
export async function loadGranolaSettings(args: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<GranolaSettings> {
  return parseGranolaSettings(await readVaultSettings(args));
}

/**
 * The addresses to offer as the person's own in Granola before any are
 * saved: those of their Person note — the one the profile's name names —
 * as meeting linking reads them. Only a suggestion: the pull reads the
 * setting alone, so what it maps by is what the person saved.
 */
export async function suggestGranolaSelfEmails({
  fs,
  markdown,
  index,
}: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
  index: Pick<IndexPort, 'query'>;
}): Promise<string[]> {
  const { name } = parseProfile(await readVaultSettings({ fs, markdown }));
  const { people } = await loadLinkDirectory({ index });
  return ownerAddresses(people, name);
}

/** Keeps the person's own addresses in Granola in the vault's settings; none removes the setting. */
export async function saveGranolaSelfEmails({
  settings,
  emails,
}: {
  settings: SettingsWriter;
  emails: readonly string[];
}): Promise<void> {
  await settings.save({ [GRANOLA_SELF_EMAILS_KEY]: emails.length === 0 ? null : emails });
}
