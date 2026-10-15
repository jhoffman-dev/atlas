import { notesAfterMoves, type EntryMove, type VaultPath } from '@atlas/domain';

/**
 * The vault's notes as the page's own filings have left them (#217), and
 * the moves the tree does not show yet.
 *
 * Filings are written one after another without waiting for the tree to be
 * read again between them, so the notes a filing is handed can still list
 * where an earlier one moved a note from. Each move the tree does not show
 * yet — its note still at `from`, nothing at `to` — is applied; one the tree
 * shows already, or that something has since overtaken, is dropped.
 */
export function notesAfterOwnMoves(
  notes: readonly VaultPath[],
  moves: readonly EntryMove[],
): { readonly notes: readonly VaultPath[]; readonly unseen: readonly EntryMove[] } {
  const present = new Set(notes);
  const unseen = moves.filter((move) => present.has(move.from) && !present.has(move.to));
  return {
    notes: unseen.length === 0 ? notes : notesAfterMoves(unseen, notes).after,
    unseen,
  };
}
