import type { Tab } from '@atlas/domain';
import { pageForPlace, type PagePlace } from '../main-route.tsx';
import { useTabPageHistory } from './tab-history.ts';
import type { WorkspaceWiring } from './workspace-wiring.tsx';

/**
 * A tab on a page — Today, the Inbox, a type's table — drawn from the props
 * the app assembled, with this tab's own Back and Forward. Drawn only while
 * it is the shown tab: a page keeps no editor to wait behind another tab.
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
  const { store, nameOf, pages, onShowSidebar } = wiring;
  const history = useTabPageHistory({ store, pane, id: tab.id, nameOf });
  return (
    <div className="pane__tab">
      {pageForPlace({
        place,
        pages,
        // The way back to a hidden sidebar sits where it went: the first pane's top-left corner.
        chrome: { history, ...(pane === 0 && onShowSidebar !== null && { onShowSidebar }) },
      })}
    </div>
  );
}
