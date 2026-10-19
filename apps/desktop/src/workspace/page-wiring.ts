import type { PagePlace, TabId, VaultPath } from '@atlas/domain';
import type { ArchivePorts } from '@atlas/application';
import type { OpenHow } from '@atlas/ui';
import type { ActivityWiring } from '../activity/activity-container.tsx';
import type { AutomationsWiring } from '../automations/automations-container.tsx';
import type { GraphWiring } from '../graph/graph-container.tsx';
import type { InboxWiring } from '../inbox/inbox-container.tsx';
import type { OverlayStore } from '../overlay-store.ts';
import type { PageHolds } from './page-holds.ts';
import type { PageChrome } from '../page-frame-fallback.tsx';
import type { PaneContext } from '../panes/note-pane-container.tsx';
import type { QueryWiring } from '../query/query-container.tsx';
import type { TagsWiring } from '../tags/tags-container.tsx';
import type { TemplatesWiring } from '../templates/templates-container.tsx';
import type { TermsWiring } from '../terms/terms-container.tsx';
import type { TodayWiring } from '../today/today-container.tsx';
import type { TypeWiring } from '../types/type-container.tsx';

/**
 * What the pages' containers are handed by the app (tab-model.md, PR B):
 * each page is a tab that reads its own hooks, and these are the ports and
 * the few window-wide things it needs to — what every page's reads and
 * writes go through, and one entry per kind for what is that kind's alone.
 * Everything a note's pane also needs comes through the pane's own context.
 */
export interface PageWiring {
  /** What a page reads the vault through and writes it through: the index, the files, the panes. */
  readonly ports: ArchivePorts;
  /** Whether the index is ready to be asked; while it builds, a page reads nothing. */
  readonly indexReady: boolean;
  /** Re-reads the tree and the index after a page wrote; settles once the index holds it. */
  readonly onSettled: () => Promise<boolean>;
  /** Opens a note where asked: here, a new tab or a split. */
  readonly openNote: (path: VaultPath, how?: OpenHow) => void;
  /** Opens a page in the focused pane's active tab. */
  readonly openPage: (place: PagePlace) => void;
  /** What the pages hold in flight for the open vault, shared by every tab on a page. */
  readonly holds: PageHolds;
  readonly today: TodayWiring;
  readonly inbox: InboxWiring;
  readonly templates: TemplatesWiring;
  readonly terms: TermsWiring;
  readonly activity: ActivityWiring;
  readonly automations: AutomationsWiring;
  readonly graph: GraphWiring;
  readonly query: QueryWiring;
  readonly tags: TagsWiring;
  readonly type: TypeWiring;
}

/** The pages' wiring with the pane's context and the overlays beside it, as the containers read them. */
export interface PageWiringContext {
  readonly pages: PageWiring;
  readonly pane: PaneContext;
  readonly overlays: OverlayStore;
}

/** What every page container is handed: the wiring, the tab it draws in, and that tab's frame. */
export interface PageContainerProps {
  readonly wiring: PageWiringContext;
  readonly tabId: TabId;
  readonly chrome: PageChrome;
}
