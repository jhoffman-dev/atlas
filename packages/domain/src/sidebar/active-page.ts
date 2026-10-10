import type { PaneLayout } from '../panes/pane-layout.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/**
 * The one page the sidebar marks as where you are: a note (which covers views
 * and dashboards, since they are notes too), a type's table, or nothing.
 */
export type ActiveSidebarPage =
  | { readonly kind: 'note'; readonly path: VaultPath }
  | { readonly kind: 'type'; readonly name: string }
  | { readonly kind: 'graph' }
  | { readonly kind: 'tags' }
  | { readonly kind: 'archive' }
  | { readonly kind: 'inbox' }
  | { readonly kind: 'review' }
  | { readonly kind: 'automations' }
  | { readonly kind: 'activity' }
  | { readonly kind: 'templates' }
  | null;

/**
 * Which page the sidebar marks, given what is on screen.
 *
 * Exactly one: the page in the focused pane. A type's table replaces the panes
 * while it is open, so it wins over whatever they still hold underneath —
 * marking both is the "two rows lit" bug. With a split the other pane is on
 * screen too, but it is not where the next open lands, and marking it as well
 * would leave the sidebar unable to say which one you are in.
 */
export function activeSidebarPage({
  layout,
  openTypeName,
  graphOpen = false,
  tagsOpen = false,
  archiveOpen = false,
  inboxOpen = false,
  reviewOpen = false,
  automationsOpen = false,
  activityOpen = false,
  templatesOpen = false,
  viewOwner = () => null,
}: {
  layout: PaneLayout;
  openTypeName: string | null;
  /** The graph replaces the panes the way a type's table does, and wins the same way. */
  graphOpen?: boolean;
  /** The tags page replaces the panes the same way. */
  tagsOpen?: boolean;
  /** So does the Archive. */
  archiveOpen?: boolean;
  /** And the Inbox. */
  inboxOpen?: boolean;
  /** And the weekly review. */
  reviewOpen?: boolean;
  /** And the Automations page. */
  automationsOpen?: boolean;
  /** And the Activity page. */
  activityOpen?: boolean;
  /** And the Templates page. */
  templatesOpen?: boolean;
  /**
   * The type a note is one of the views of, or null. A type owns its views
   * (ADR-0023), so a pane on one of them is that type's page and marks the type.
   */
  viewOwner?: (path: VaultPath) => string | null;
}): ActiveSidebarPage {
  if (archiveOpen) return { kind: 'archive' };
  if (inboxOpen) return { kind: 'inbox' };
  if (reviewOpen) return { kind: 'review' };
  if (automationsOpen) return { kind: 'automations' };
  if (activityOpen) return { kind: 'activity' };
  if (templatesOpen) return { kind: 'templates' };
  if (graphOpen) return { kind: 'graph' };
  if (tagsOpen) return { kind: 'tags' };
  if (openTypeName !== null) return { kind: 'type', name: openTypeName };
  const path = layout.paths[layout.focused] ?? null;
  if (path === null) return null;
  const owner = viewOwner(path);
  return owner === null ? { kind: 'note', path } : { kind: 'type', name: owner };
}
