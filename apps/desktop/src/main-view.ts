import { useCallback, useMemo, useState } from 'react';
import type { GraphScope, NavigationPlace } from '@atlas/domain';
import type { TypePageMode } from './types/type-page.tsx';
import { openPlace, useShownPages, type WorkspaceStore } from './workspace/workspace-store.ts';

/**
 * The pages the panes show, as the app that assembles their props sees them
 * (tab-model.md, PR A): a page is a tab's place now, so this reads which
 * pages the panes' shown tabs are on — the focused pane's first — and offers
 * the ways to open each in the active tab. It is drawn again for a page
 * coming or going, not for a switch between notes.
 *
 * One of each page at a time: the type whose table is assembled is the
 * focused pane's, else the other pane's. PR B gives each page kind a
 * container of its own and deletes this.
 */
export function useMainView(store: WorkspaceStore) {
  const pages = useShownPages(store);
  const [typeMode, setTypeMode] = useState<TypePageMode>('notes');
  const open = useCallback((place: NavigationPlace) => openPlace(store, place, 'here'), [store]);

  const openType = useCallback(
    (name: string, mode: TypePageMode = 'notes') => {
      setTypeMode(mode);
      open({ kind: 'type', name });
    },
    [open],
  );
  const openGraph = useCallback((scope: GraphScope) => open({ kind: 'graph', scope }), [open]);
  const openQuery = useCallback(() => open({ kind: 'query' }), [open]);
  const openTags = useCallback((tag: string | null = null) => open({ kind: 'tags', tag }), [open]);
  const openArchive = useCallback(() => open({ kind: 'archive' }), [open]);
  const openInbox = useCallback(() => open({ kind: 'inbox' }), [open]);
  const openReview = useCallback(() => open({ kind: 'review' }), [open]);
  const openToday = useCallback(() => open({ kind: 'today' }), [open]);
  const openAutomations = useCallback(() => open({ kind: 'automations' }), [open]);
  const openActivity = useCallback(() => open({ kind: 'activity' }), [open]);
  const openTemplates = useCallback(() => open({ kind: 'templates' }), [open]);
  const openTerms = useCallback(() => open({ kind: 'terms' }), [open]);

  return useMemo(() => {
    const first = <Kind extends NavigationPlace['kind']>(kind: Kind) =>
      pages.find((page): page is Extract<NavigationPlace, { kind: Kind }> => page.kind === kind) ??
      null;
    const shown = (kind: NavigationPlace['kind']) => pages.some((page) => page.kind === kind);
    return {
      /** The type whose page is open, or null. */
      openTypeName: first('type')?.name ?? null,
      typeMode,
      graphScope: first('graph')?.scope ?? null,
      queryOpen: shown('query'),
      /** The tags page's chosen tag; undefined while the page is not open. */
      tagsTag: first('tags')?.tag,
      archiveOpen: shown('archive'),
      inboxOpen: shown('inbox'),
      reviewOpen: shown('review'),
      todayOpen: shown('today'),
      automationsOpen: shown('automations'),
      activityOpen: shown('activity'),
      templatesOpen: shown('templates'),
      termsOpen: shown('terms'),
      openType,
      setTypeMode,
      openGraph,
      openQuery,
      openTags,
      openArchive,
      openInbox,
      openReview,
      openToday,
      openAutomations,
      openActivity,
      openTemplates,
      openTerms,
    };
  }, [
    pages,
    typeMode,
    openType,
    openGraph,
    openQuery,
    openTags,
    openArchive,
    openInbox,
    openReview,
    openToday,
    openAutomations,
    openActivity,
    openTemplates,
    openTerms,
  ]);
}
