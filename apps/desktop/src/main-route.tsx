import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import type { GraphScope } from '@atlas/domain';
import {
  ArchivePage,
  InboxPage,
  TemplatesPage,
  WeeklyReviewPage,
  type PageHistory,
} from '@atlas/ui';
import { TypePage } from './types/type-page.tsx';
import { QueryScreen } from './query/query-screen.tsx';
import { TagsScreen } from './tags/tags-screen.tsx';
import { AutomationsScreen } from './automations/automations-screen.tsx';
import { ActivityScreen } from './activity/activity-screen.tsx';

// Loaded on first use, so d3-force and the drawing stay out of the main bundle.
const GraphPage = lazy(() => import('./graph/graph-page.tsx'));

type GraphProps = Omit<ComponentProps<typeof GraphPage>, 'scope' | 'onShowSidebar' | 'history'>;
type TypeProps = Omit<ComponentProps<typeof TypePage>, 'onShowSidebar' | 'history'>;
type QueryProps = Omit<ComponentProps<typeof QueryScreen>, 'onShowSidebar' | 'history'>;
type TagsProps = Omit<ComponentProps<typeof TagsScreen>, 'selected' | 'onShowSidebar' | 'history'>;

type ArchiveProps = Omit<ComponentProps<typeof ArchivePage>, 'onShowSidebar' | 'history'>;
type InboxProps = Omit<ComponentProps<typeof InboxPage>, 'onShowSidebar' | 'history'>;
type ReviewProps = Omit<ComponentProps<typeof WeeklyReviewPage>, 'onShowSidebar' | 'history'>;
type AutomationsProps = Omit<ComponentProps<typeof AutomationsScreen>, 'onShowSidebar' | 'history'>;
type ActivityProps = Omit<ComponentProps<typeof ActivityScreen>, 'onShowSidebar' | 'history'>;
type TemplatesProps = Omit<ComponentProps<typeof TemplatesPage>, 'onShowSidebar' | 'history'>;

/**
 * The page open over the panes, if any: the graph, a type's page, the query
 * page, the tags, the Archive, the Inbox, the weekly review, the Automations, the Activity or the Templates page, in that order when more than one
 * could show. Null leaves the panes —
 * which is why this is called rather than rendered as a component: the shell
 * shows the panes only when it is handed no page at all.
 */
export function mainRoute({
  graph,
  type,
  query,
  tags,
  archive,
  inbox,
  review,
  automations,
  activity,
  templates,
  onShowSidebar,
  history,
}: {
  /** The graph's scope is null while the graph is not open. */
  graph: GraphProps & { scope: GraphScope | null };
  /** Shows only while its table has a type: a type that is gone shows nothing. */
  type: TypeProps;
  query: { open: boolean; screen: QueryProps };
  /** The chosen tag's key, null for none; undefined while the tags page is not open. */
  tags: { selected: string | null | undefined; screen: TagsProps };
  archive: { open: boolean; page: ArchiveProps };
  inbox: { open: boolean; page: InboxProps };
  review: { open: boolean; page: ReviewProps };
  automations: { open: boolean; screen: AutomationsProps };
  activity: { open: boolean; screen: ActivityProps };
  templates: { open: boolean; page: TemplatesProps };
  onShowSidebar?: () => void;
  /** The focused pane's Back and Forward: the page is shown in its place. */
  history?: PageHistory;
}): ReactNode | null {
  const sidebar = {
    ...(onShowSidebar !== undefined && { onShowSidebar }),
    ...(history !== undefined && { history }),
  };
  if (graph.scope !== null) {
    return (
      <Suspense fallback={<p className="viewer viewer--muted">Opening the graph…</p>}>
        <GraphPage {...graph} scope={graph.scope} {...sidebar} />
      </Suspense>
    );
  }
  if (type.table.type !== null) {
    // One editor per type: its queued changes and open question belong to that file.
    return <TypePage key={type.table.type.name} {...type} {...sidebar} />;
  }
  if (query.open) return <QueryScreen {...query.screen} {...sidebar} />;
  if (tags.selected !== undefined) {
    return <TagsScreen {...tags.screen} selected={tags.selected} {...sidebar} />;
  }
  if (archive.open) return <ArchivePage {...archive.page} {...sidebar} />;
  if (inbox.open) return <InboxPage {...inbox.page} {...sidebar} />;
  if (review.open) return <WeeklyReviewPage {...review.page} {...sidebar} />;
  if (automations.open) return <AutomationsScreen {...automations.screen} {...sidebar} />;
  if (activity.open) return <ActivityScreen {...activity.screen} {...sidebar} />;
  if (templates.open) return <TemplatesPage {...templates.page} {...sidebar} />;
  return null;
}
