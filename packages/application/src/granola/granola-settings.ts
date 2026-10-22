import { parseGranolaSettings, type GranolaSettings } from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * What the vault's settings note says about Granola: among it everything the
 * mapper is told besides the note — the zone, the group addresses and the
 * owner's own addresses (`selfEmails`, read through its Granola alias too) —
 * so that every Mac maps a note into the same bytes (ADR-0034).
 */
export async function loadGranolaSettings(args: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}): Promise<GranolaSettings> {
  return parseGranolaSettings(await readVaultSettings(args));
}
