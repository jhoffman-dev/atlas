import { TITLE_KEY } from '../page/page-title.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { tidySpelling } from './spelling.ts';

export { variantsFromInput } from './variants-input.ts';

/** The `type:` a term's note declares. */
export const TERM_TYPE = 'term';

/** The misheard spellings of a term, as a list in its frontmatter. */
export const VARIANTS_KEY = 'variants';

/** What a term names: one of {@link TERM_KINDS}. */
export const TERM_KIND_KEY = 'kind';

/** Other spellings of a person's or a company's name, as a list in their frontmatter. */
export const ALIASES_KEY = 'aliases';

/** What a term can name. */
export const TERM_KINDS = ['product', 'person', 'company', 'acronym', 'other'] as const;

export type TermKind = (typeof TERM_KINDS)[number];

/**
 * A term's note: the one right spelling (its title), the ways it is misheard,
 * and what it names.
 */
export interface TermNote {
  readonly path: VaultPath;
  readonly canonical: string;
  readonly variants: readonly string[];
  readonly kind: TermKind | null;
}

/** The kind a note's `kind:` names, or null when it names none Atlas knows. */
export function termKindOf(value: unknown): TermKind | null {
  return TERM_KINDS.find((kind) => kind === value) ?? null;
}

/** Why a term cannot be made of what was typed as its spelling, or null. */
export function newTermRefusal(canonical: string): string | null {
  return tidySpelling(canonical) === '' ? 'A term needs its right spelling.' : null;
}

/**
 * What a new term's frontmatter is changed by. Its spelling is its title, and
 * the file is named after it — but a file name cannot hold every character
 * (`S/4`, `Q3: plan`) and a taken one is numbered, so when the name the file
 * ended up with is not the spelling, the spelling is written as `title`. So
 * it is when the note starts with a `title` of its own, a template's: a
 * `title` is what names a note, and the template's would name every term.
 */
export function newTermProperties({
  canonical,
  fileTitle,
  startsTitled,
  variants,
  kind,
}: {
  canonical: string;
  /** The title the new note's file name gives it. */
  fileTitle: string;
  /** Whether what the note starts as (its template) has a `title` already. */
  startsTitled: boolean;
  variants: readonly string[];
  kind: TermKind | null;
}): Record<string, unknown> {
  const spelling = tidySpelling(canonical);
  return {
    type: TERM_TYPE,
    ...((startsTitled || fileTitle !== spelling) && { [TITLE_KEY]: spelling }),
    ...(kind !== null && { [TERM_KIND_KEY]: kind }),
    ...(variants.length > 0 && { [VARIANTS_KEY]: [...variants] }),
  };
}
