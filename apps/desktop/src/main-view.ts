import { useCallback, useMemo, useState } from 'react';
import type { GraphScope } from '@atlas/domain';
import type { TypePageMode } from './types/type-page.tsx';

/**
 * What fills the main area: the panes, or one page in their place — a type's
 * table or editor, the graph, the query page, the tags (with the key of the
 * tag whose notes are listed, if one is), the Archive, the Inbox, the Automations page, the Activity page,
 * the Templates page, the Terms page or the Proposals page.
 * Only one at a time; the panes
 * keep what they hold underneath, and leaving the page puts them back.
 */
export type MainView =
  | { readonly kind: 'panes' }
  | { readonly kind: 'type'; readonly name: string; readonly mode: TypePageMode }
  | { readonly kind: 'graph'; readonly scope: GraphScope }
  | { readonly kind: 'query' }
  | { readonly kind: 'tags'; readonly tag: string | null }
  | { readonly kind: 'archive' }
  | { readonly kind: 'inbox' }
  | { readonly kind: 'automations' }
  | { readonly kind: 'activity' }
  | { readonly kind: 'templates' }
  | { readonly kind: 'terms' }
  | { readonly kind: 'proposals' };

const PANES: MainView = { kind: 'panes' };

/** The page over the panes, and the ways to open and leave each. */
export function useMainView() {
  const [view, setView] = useState<MainView>(PANES);

  const showPanes = useCallback(() => setView(PANES), []);
  const openType = useCallback(
    (name: string, mode: TypePageMode = 'notes') => setView({ kind: 'type', name, mode }),
    [],
  );
  const setTypeMode = useCallback(
    (mode: TypePageMode) => setView((was) => (was.kind === 'type' ? { ...was, mode } : was)),
    [],
  );
  const openGraph = useCallback((scope: GraphScope) => setView({ kind: 'graph', scope }), []);
  const openQuery = useCallback(() => setView({ kind: 'query' }), []);
  const openTags = useCallback((tag: string | null = null) => setView({ kind: 'tags', tag }), []);
  const openArchive = useCallback(() => setView({ kind: 'archive' }), []);
  const openInbox = useCallback(() => setView({ kind: 'inbox' }), []);
  const openAutomations = useCallback(() => setView({ kind: 'automations' }), []);
  const openActivity = useCallback(() => setView({ kind: 'activity' }), []);
  const openTemplates = useCallback(() => setView({ kind: 'templates' }), []);
  const openTerms = useCallback(() => setView({ kind: 'terms' }), []);
  const openProposals = useCallback(() => setView({ kind: 'proposals' }), []);

  return useMemo(
    () => ({
      view,
      /** The type whose page is open, or null. */
      openTypeName: view.kind === 'type' ? view.name : null,
      typeMode: view.kind === 'type' ? view.mode : ('notes' as const),
      graphScope: view.kind === 'graph' ? view.scope : null,
      queryOpen: view.kind === 'query',
      /** The tags page's chosen tag; undefined while the page is not open. */
      tagsTag: view.kind === 'tags' ? view.tag : undefined,
      archiveOpen: view.kind === 'archive',
      inboxOpen: view.kind === 'inbox',
      automationsOpen: view.kind === 'automations',
      activityOpen: view.kind === 'activity',
      templatesOpen: view.kind === 'templates',
      termsOpen: view.kind === 'terms',
      proposalsOpen: view.kind === 'proposals',
      showPanes,
      openType,
      setTypeMode,
      openGraph,
      openQuery,
      openTags,
      openArchive,
      openInbox,
      openAutomations,
      openActivity,
      openTemplates,
      openTerms,
      openProposals,
    }),
    [
      view,
      showPanes,
      openType,
      setTypeMode,
      openGraph,
      openQuery,
      openTags,
      openArchive,
      openInbox,
      openAutomations,
      openActivity,
      openTemplates,
      openTerms,
      openProposals,
    ],
  );
}
