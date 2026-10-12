import { listInputCells } from '../types/list-input.ts';
import { tidySpelling } from './spelling.ts';

/**
 * The spellings typed into a term's one variants box, which shows them with
 * the shared list codec (`listAsInput`): split at the commas outside quotes,
 * so a variant holding a comma of its own — `Quill, Mara`, as the properties
 * panel, the API and the file can all write — stays whole; then tidied as a
 * spelling, blanks dropped, and a repeat kept once. Capitals count: matching
 * is case-sensitive, so `mark` and `Mark` are two spellings. A quote never closed runs to the end of the line.
 */
export function variantsFromInput(typed: string): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const part of listInputCells(typed)) {
    const variant = tidySpelling(part);
    if (variant === '' || seen.has(variant)) continue;
    seen.add(variant);
    variants.push(variant);
  }
  return variants;
}
