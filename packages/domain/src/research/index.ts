/*
 * The research area's lists (#507): the Library of literature notes and All
 * highlights across them — what each reads from the index, and how each is
 * filtered and ordered. Every function here is pure.
 */
export {
  compileHighlightsQuery,
  compileLibraryQuery,
  HIGHLIGHT_TEXT_LIMIT,
  HIGHLIGHTS_PAGE_SIZE,
  HIGHLIGHTS_QUERY_COLUMNS,
  HIGHLIGHTS_QUERY_MARK,
  LIBRARY_PAGE_SIZE,
  LIBRARY_QUERY_COLUMNS,
  LIBRARY_QUERY_MARK,
  LIST_SEPARATOR,
  PAIR_SEPARATOR,
} from './research-query.ts';
export {
  DEFAULT_LIBRARY_SORT,
  filterLibrary,
  libraryChoices,
  libraryCover,
  libraryShown,
  NO_LIBRARY_FILTER,
  projectKey,
  sortLibrary,
  SOURCE_KIND_HUES,
  SOURCE_KIND_LABELS,
} from './library.ts';
export type {
  LibraryChoices,
  LibraryEntry,
  LibraryFilter,
  LibraryProject,
  LibrarySort,
  LibrarySortKey,
} from './library.ts';
export {
  CHANGED_WITHIN_MS,
  filterHighlights,
  hasComment,
  HIGHLIGHT_HUES,
  highlightChoices,
  highlightColor,
  highlightEmbed,
  highlightPlace,
  joinHighlights,
  NO_HIGHLIGHT_FILTER,
} from './highlight-list.ts';
export type {
  ChangedWithin,
  CommentFilter,
  HighlightChoices,
  HighlightEntry,
  HighlightFilter,
  ListedHighlight,
} from './highlight-list.ts';
export { changedOn, withToggled } from './research-text.ts';
export type { ResearchChoice } from './research-text.ts';
