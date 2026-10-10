import { listInputCells } from '../types/list-input.ts';
import { tidySpelling, vocabularyKey } from './spelling.ts';

/**
 * The spellings typed into a term's one variants box, which shows them with
 * the shared list codec (`listAsInput`): split at the commas outside quotes,
 * so a variant holding a comma of its own — `Quill, Mara`, as the properties
 * panel, the API and the file can all write — stays whole; then tidied as a
 * spelling, blanks dropped, and a repeat in any case kept once, as first
 * typed. A quote never closed runs to the end of the line.
 */
export function variantsFromInput(typed: string): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const part of listInputCells(typed)) {
    const variant = tidySpelling(part);
    const key = vocabularyKey(variant);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    variants.push(variant);
  }
  return variants;
}
