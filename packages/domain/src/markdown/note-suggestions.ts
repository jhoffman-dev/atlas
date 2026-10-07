import { noteTitle } from '../vault/vault-entry.ts';
import { vaultPathDepth, type VaultPath } from '../vault/vault-path.ts';
import { isTemplateNote } from '../vault/vault-visibility.ts';
import { wikiLinkTargetFor } from './resolve-wikilink.ts';

export interface NoteSuggestion {
  readonly path: VaultPath;
  /**
   * What the link would be written as: the note's name without its extension,
   * or its path when the name alone would open another note of that name.
   */
  readonly target: string;
}

const DEFAULT_LIMIT = 12;

/**
 * Notes to offer for a half-typed wiki link.
 *
 * A name that starts with what was typed beats one that merely contains it, and
 * among equals the note closest to the vault root wins. Ordering is total, so the
 * list never reshuffles between keystrokes for reasons the user cannot see.
 *
 * `linkable` is every note a link can open — archived ones too, which are
 * not offered but still answer to their name — so the link written opens the
 * note that was picked (A20-05). It is `notes` when not given.
 */
export function rankNoteSuggestions(
  query: string,
  notes: readonly VaultPath[],
  {
    limit = DEFAULT_LIMIT,
    linkable = notes,
  }: { limit?: number; linkable?: readonly VaultPath[] } = {},
): NoteSuggestion[] {
  const wanted = query.trim().toLowerCase();

  const scored = notes
    // A template is no link target (ADR-0026), whatever list it arrives in.
    .filter((path) => !isTemplateNote(path))
    .map((path) => ({ path, name: noteTitle(path) }))
    .map((note) => ({ ...note, score: scoreOf(note.name.toLowerCase(), wanted) }))
    .filter((note) => note.score > 0);

  scored.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    const depth = vaultPathDepth(left.path) - vaultPathDepth(right.path);
    if (depth !== 0) return depth;
    return left.path.localeCompare(right.path);
  });

  return scored
    .slice(0, limit)
    .map(({ path }) => ({ path, target: wikiLinkTargetFor(path, linkable) }));
}

function scoreOf(name: string, query: string): number {
  if (query === '') return 1;
  if (name === query) return 4;
  if (name.startsWith(query)) return 3;
  if (name.includes(query)) return 2;
  return 0;
}
