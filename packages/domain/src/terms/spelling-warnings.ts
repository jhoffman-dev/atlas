import type { VaultPath } from '../vault/vault-path.ts';
import { isSearchable, tidySpelling } from './spelling.ts';
import type { TermNote } from './term.ts';
import type { Vocabulary } from './vocabulary.ts';

/** Why a term's misheard spelling may not do what its author meant. */
export type SpellingWarning =
  | {
      readonly kind: 'unusable';
      readonly path: VaultPath;
      readonly variant: string;
    }
  | {
      readonly kind: 'inside-name';
      readonly path: VaultPath;
      readonly variant: string;
      /** The right spelling, of another note, that holds the variant as words of its own. */
      readonly name: string;
    };

/**
 * What to tell the person who lists these misheard spellings (P28-06):
 *
 * - a spelling with no letter or digit in it is not used at all;
 * - a spelling that is a word, or words in a row, of another note's right
 *   spelling (`Quill` in `Mara Quill`) is also corrected wherever it stands
 *   alone — the name written whole is left as it is, but a lone `Quill` turns
 *   into this term's right spelling.
 */
export function spellingWarnings({
  terms,
  vocabulary,
}: {
  terms: readonly TermNote[];
  vocabulary: Pick<Vocabulary, 'entries'>;
}): SpellingWarning[] {
  const namesByWord = namesByFirstWord(vocabulary);
  const warnings: SpellingWarning[] = [];
  for (const term of terms) {
    const canonical = tidySpelling(term.canonical);
    for (const written of term.variants) {
      const variant = tidySpelling(written);
      if (variant === '') continue;
      if (!isSearchable(variant)) {
        warnings.push({ kind: 'unusable', path: term.path, variant });
        continue;
      }
      const name = (namesByWord.get(variant.split(' ')[0] ?? '') ?? []).find(
        (candidate) => candidate !== canonical && hasWordsInARow(candidate, variant),
      );
      if (name !== undefined)
        warnings.push({ kind: 'inside-name', path: term.path, variant, name });
    }
  }
  return warnings;
}

/** Each right spelling under every one of its words, so a variant looks only at the names holding its first word. */
function namesByFirstWord(vocabulary: Pick<Vocabulary, 'entries'>): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const canonical of new Set(vocabulary.entries.map((entry) => entry.canonical))) {
    for (const word of new Set(canonical.split(' '))) {
      names.set(word, [...(names.get(word) ?? []), canonical]);
    }
  }
  return names;
}

function hasWordsInARow(name: string, variant: string): boolean {
  return ` ${name} `.includes(` ${variant} `);
}
