import { noteTitle } from '../vault/vault-entry.ts';
import { vaultPathDepth, type VaultPath } from '../vault/vault-path.ts';
import { isTemplateNote } from '../vault/vault-visibility.ts';
import { linkMatchOf, linkMatchStrength } from './link-suggestions.ts';
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
 * Names meet what was typed as a link field's suggestions do (#465,
 * `linkMatchOf`): the whole name, then its start, a word's start, a part,
 * then its letters in order — case and accents aside. Among equals the note
 * closest to the vault root wins. Ordering is total, so the
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
  const scored = notes
    // A template is no link target (ADR-0026), whatever list it arrives in.
    .filter((path) => !isTemplateNote(path))
    .map((path) => ({ path, name: noteTitle(path) }))
    .flatMap((note) => {
      const match = linkMatchOf(note.name, query);
      return match === null ? [] : [{ ...note, score: linkMatchStrength(match) }];
    });

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
