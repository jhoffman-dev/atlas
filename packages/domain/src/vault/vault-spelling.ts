import type { VaultPath } from './vault-path.ts';

/**
 * The note in `notes` that `wanted` names, spelled as the vault spells it.
 *
 * APFS ignores case and Unicode normalization, so `tasks/call sam.md` opens
 * `Tasks/Call Sam.md` — but everything that compares paths as strings (the
 * panes, the index) knows only the vault's own spelling. An exact match wins;
 * then one differing only in normalization; then one differing in case too.
 * Two notes that match equally loosely, which a case-sensitive disk can hold,
 * are ambiguous: null, rather than pick one the caller may not have meant.
 */
export function vaultSpellingOf(wanted: VaultPath, notes: readonly VaultPath[]): VaultPath | null {
  if (notes.includes(wanted)) return wanted;
  for (const loosen of [composed, folded]) {
    const matching = notes.filter((note) => loosen(note) === loosen(wanted));
    if (matching.length === 1) return matching[0] ?? null;
    if (matching.length > 1) return null;
  }
  return null;
}

const composed = (path: string): string => path.normalize('NFC');
const folded = (path: string): string => composed(path).toLowerCase();

/**
 * A path as the disk tells paths apart: composed and lower-cased, so two
 * spellings that open the same entry on APFS fold to the same text. For
 * deciding whether a name is taken, never for writing.
 */
export const foldedVaultPath = folded;
