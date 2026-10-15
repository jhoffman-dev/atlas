import { vaultPathName, type VaultPath } from './vault-path.ts';

/** How many near paths a missing note is answered with. */
export const NEAREST_NOTE_PATHS = 5;

/** A name's words, as a search would see them: lower case, letters and digits only. */
function wordsOf(name: string): Set<string> {
  const stem = name.normalize('NFC').toLowerCase().replace(/\.md$/, '');
  return new Set(stem.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== ''));
}

/** How alike two names are: 2 when they are the same name, else the share of words they have in common. */
function likeness(wanted: Set<string>, wantedName: string, path: VaultPath): number {
  const name = vaultPathName(path);
  if (name.normalize('NFC').toLowerCase() === wantedName) return 2;
  const words = wordsOf(name);
  const shared = [...wanted].filter((word) => words.has(word)).length;
  const all = new Set([...wanted, ...words]).size;
  return all === 0 ? 0 : shared / all;
}

/**
 * The notes most like one that is not there, by file name: the same name in
 * another folder first, then those sharing the most words with it. A path
 * guessed from a title — `Meeting Notes/2026-10-14 Standup.md` — finds the
 * note it meant wherever it is filed. Nothing in common, nothing answered.
 */
export function nearestNotePaths(
  wanted: VaultPath,
  paths: readonly VaultPath[],
  limit = NEAREST_NOTE_PATHS,
): VaultPath[] {
  const wantedName = vaultPathName(wanted).normalize('NFC').toLowerCase();
  const words = wordsOf(wantedName);
  return paths
    .map((path) => ({ path, score: likeness(words, wantedName, path) }))
    .filter(({ path, score }) => score > 0 && path !== wanted)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map(({ path }) => path);
}
