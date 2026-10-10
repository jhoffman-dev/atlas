export {
  ALIASES_KEY,
  newTermProperties,
  newTermRefusal,
  TERM_KIND_KEY,
  TERM_KINDS,
  TERM_TYPE,
  termKindOf,
  VARIANTS_KEY,
} from './term.ts';
export { variantsFromInput } from './variants-input.ts';
export type { TermKind, TermNote } from './term.ts';
export { tidySpelling, vocabularyKey } from './spelling.ts';
export { vocabulary } from './vocabulary.ts';
export type {
  NamedEntity,
  Vocabulary,
  VocabularyClaim,
  VocabularyConflict,
  VocabularyEntry,
  VocabularySource,
  VocabularySources,
} from './vocabulary.ts';
export {
  compileVocabularyQuery,
  VOCABULARY_PAGE_SIZE,
  vocabularySourcesOf,
} from './vocabulary-query.ts';
export type { VocabularyRow } from './vocabulary-query.ts';
