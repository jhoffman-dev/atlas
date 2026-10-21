import {
  dismissDuplicateChanges,
  dismissedDuplicates,
  possibleDuplicates,
  type DuplicatePair,
  type VaultPath,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings, type SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What reading the possible duplicates needs: the index's people and the vault's settings. */
export interface DuplicatesPorts {
  readonly index: Pick<IndexPort, 'query'>;
  readonly fs: Pick<VaultFsPort, 'readNotes'>;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}

/**
 * The pairs of people who may be one person (#464), from the index's people
 * as meeting import reads them, less the pairs already said not to be — kept
 * in the vault's settings, so the answer travels with the vault.
 */
export async function loadPossibleDuplicates(ports: DuplicatesPorts): Promise<DuplicatePair[]> {
  const [{ people }, settings] = await Promise.all([
    loadLinkDirectory({ index: ports.index }),
    readVaultSettings({ fs: ports.fs, markdown: ports.markdown }),
  ]);
  return possibleDuplicates({ people, dismissed: dismissedDuplicates(settings) });
}

/**
 * Remembers that two people are not one, so the pair is not offered again:
 * added, in the settings writer's turn, to the pairs remembered at that
 * moment — so two pairs dismissed at once are both kept.
 */
export async function dismissPossibleDuplicate({
  settings,
  pair,
}: {
  /** The vault's ports, as the list was read through. Not read again here: the writer reads in its turn. */
  ports?: Pick<DuplicatesPorts, 'fs' | 'markdown'>;
  settings: SettingsWriter;
  pair: { readonly left: VaultPath; readonly right: VaultPath };
}): Promise<void> {
  await settings.update((current) => dismissDuplicateChanges(current, pair));
}
