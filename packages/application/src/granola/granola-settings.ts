import {
  ownerAddresses,
  parseGranolaSettings,
  parseProfile,
  type GranolaFileOptions,
  type GranolaSettings,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What the vault's settings note says about Granola. */
export async function loadGranolaSettings(args: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<GranolaSettings> {
  return parseGranolaSettings(await readVaultSettings(args));
}

/**
 * Everything the mapper is told besides the note, read from the vault so
 * that every Mac maps a note into the same bytes (ADR-0034): the zone and
 * the group addresses from its settings, and the person's own addresses
 * from their Person note — the one the profile's name names — as meeting
 * linking reads them.
 */
export async function loadGranolaMappingOptions({
  settings,
  index,
}: {
  /** The vault's settings note, as read. */
  settings: Readonly<Record<string, unknown>>;
  index: Pick<IndexPort, 'query'>;
}): Promise<GranolaFileOptions> {
  const { timeZone, groupAddresses } = parseGranolaSettings(settings);
  const { name } = parseProfile(settings);
  const { people } = await loadLinkDirectory({ index });
  return { timeZone, groupAddresses, selfEmails: ownerAddresses(people, name) };
}
