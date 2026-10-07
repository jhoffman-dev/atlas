import type { ViewLayout } from '../query/saved-view.ts';

/**
 * What an open page is, as far as its header is concerned: a note of some
 * type, a saved view with its layout, a dashboard, a source, or a type's own
 * generated table, or the SQL query page.
 */
export type PageKind =
  | { readonly kind: 'note'; readonly typeName: string | null }
  | { readonly kind: 'view'; readonly layout: ViewLayout }
  | { readonly kind: 'dashboard' }
  | { readonly kind: 'source' }
  | { readonly kind: 'type'; readonly typeName: string }
  /** A template, opened to be edited: what new notes start as, never a note itself. */
  | { readonly kind: 'template'; readonly typeName: string | null }
  /** The SQL query page, which is not a note until it is saved as a view. */
  | { readonly kind: 'query' };
