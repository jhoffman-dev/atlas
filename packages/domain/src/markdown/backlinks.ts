import type { VaultPath } from '../vault/vault-path.ts';
import { resolveWikiLinkTarget } from './resolve-wikilink.ts';

/** One link found in the vault: the note it sits in, and what it points at. */
export interface NoteLink {
  readonly source: VaultPath;
  readonly target: string;
}

/**
 * The notes that link to a given note.
 *
 * Resolution runs per link rather than by comparing text, so `[[today]]`,
 * `[[Today]]` and `[[Notes/Today]]` all count as links to the same note.
 * A note linking to itself is left out; it is never what the panel is for.
 */
export function backlinksFor({
  links,
  notePaths,
  note,
}: {
  links: readonly NoteLink[];
  notePaths: readonly VaultPath[];
  note: VaultPath;
}): VaultPath[] {
  const sources = new Set<VaultPath>();

  for (const link of links) {
    if (link.source === note) continue;
    if (resolveWikiLinkTarget(link.target, notePaths) === note) sources.add(link.source);
  }

  return [...sources].sort((left, right) => left.localeCompare(right));
}
