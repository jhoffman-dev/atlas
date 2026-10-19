import type { ReactNode } from 'react';
import type { PagePlace, Tab, TabId } from '@atlas/domain';
import { ActivityContainer } from '../activity/activity-container.tsx';
import { ArchiveContainer } from '../archive/archive-container.tsx';
import { AutomationsContainer } from '../automations/automations-container.tsx';
import { GraphContainer } from '../graph/graph-container.tsx';
import { InboxContainer } from '../inbox/inbox-container.tsx';
import type { PageChrome } from '../page-frame-fallback.tsx';
import { QueryContainer } from '../query/query-container.tsx';
import { ReviewContainer } from '../review/review-container.tsx';
import { TagsContainer } from '../tags/tags-container.tsx';
import { TemplatesContainer } from '../templates/templates-container.tsx';
import { TermsContainer } from '../terms/terms-container.tsx';
import { TodayContainer } from '../today/today-container.tsx';
import { TypeContainer } from '../types/type-container.tsx';
import type { PageWiringContext } from './page-wiring.ts';
import { useTabPageHistory } from './tab-history.ts';
import type { WorkspaceWiring } from './workspace-wiring.tsx';

/**
 * A tab on a page — Today, the Inbox, a type's table — drawn by the page's
 * own container, which reads the page's hooks (tab-model.md, PR B), with
 * this tab's own Back and Forward. Drawn only while it is the shown tab: a
 * page keeps no editor to wait behind another tab.
 */
export function PageTab({
  wiring,
  pane,
  tab,
  place,
}: {
  wiring: WorkspaceWiring;
  pane: number;
  tab: Tab;
  place: PagePlace;
}) {
  const { store, nameOf, onShowSidebar, overlays } = wiring;
  const history = useTabPageHistory({ store, pane, id: tab.id, nameOf });
  // The way back to a hidden sidebar sits where it went: the first pane's top-left corner.
  const chrome: PageChrome = {
    history,
    ...(pane === 0 && onShowSidebar !== null && { onShowSidebar }),
  };
  const pages: PageWiringContext = { pages: wiring.pages, pane: wiring.pane, overlays };
  return (
    <div className="pane__tab">{containerFor({ place, wiring: pages, tabId: tab.id, chrome })}</div>
  );
}

/** The page a place names, by its kind, in its container. */
function containerFor({
  place,
  ...props
}: {
  place: PagePlace;
  wiring: PageWiringContext;
  tabId: TabId;
  chrome: PageChrome;
}): ReactNode {
  switch (place.kind) {
    case 'graph':
      return <GraphContainer {...props} scope={place.scope} />;
    case 'type':
      return <TypeContainer {...props} name={place.name} />;
    case 'query':
      return <QueryContainer {...props} />;
    case 'tags':
      return <TagsContainer {...props} selected={place.tag} />;
    case 'archive':
      return <ArchiveContainer {...props} />;
    case 'inbox':
      return <InboxContainer {...props} />;
    case 'review':
      return <ReviewContainer {...props} />;
    case 'today':
      return <TodayContainer {...props} />;
    case 'automations':
      return <AutomationsContainer {...props} />;
    case 'activity':
      return <ActivityContainer {...props} />;
    case 'templates':
      return <TemplatesContainer {...props} />;
    case 'terms':
      return <TermsContainer {...props} />;
  }
}
