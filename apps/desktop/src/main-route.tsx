import { Suspense, type ComponentProps, type ReactNode } from 'react';
import type { GraphScope } from '@atlas/domain';
import { InboxPage, TodayPage, type PageHistory } from '@atlas/ui';
import {
  activityScreen,
  archivePage,
  automationsScreen,
  graphPage,
  queryScreen,
  tagsScreen,
  templatesPage,
  termsPage,
  typePage,
  weeklyReviewPage,
} from './pages-on-first-use.ts';
import { PageFrameFallback } from './page-frame-fallback.tsx';

// Loaded on first use (`pages-on-first-use.ts`); Today and the Inbox are what start-up shows.
const GraphPage = graphPage.Component;
const TypePage = typePage.Component;
const QueryScreen = queryScreen.Component;
const TagsScreen = tagsScreen.Component;
const ArchivePage = archivePage.Component;
const WeeklyReviewPage = weeklyReviewPage.Component;
const AutomationsScreen = automationsScreen.Component;
const ActivityScreen = activityScreen.Component;
const TemplatesPage = templatesPage.Component;
const TermsPage = termsPage.Component;

type GraphProps = Omit<ComponentProps<typeof GraphPage>, 'scope' | 'onShowSidebar' | 'history'>;
type TypeProps = Omit<ComponentProps<typeof TypePage>, 'onShowSidebar' | 'history'>;
type QueryProps = Omit<ComponentProps<typeof QueryScreen>, 'onShowSidebar' | 'history'>;
type TagsProps = Omit<ComponentProps<typeof TagsScreen>, 'selected' | 'onShowSidebar' | 'history'>;

type ArchiveProps = Omit<ComponentProps<typeof ArchivePage>, 'onShowSidebar' | 'history'>;
type InboxProps = Omit<ComponentProps<typeof InboxPage>, 'onShowSidebar' | 'history'>;
type ReviewProps = Omit<ComponentProps<typeof WeeklyReviewPage>, 'onShowSidebar' | 'history'>;
type TodayProps = Omit<ComponentProps<typeof TodayPage>, 'onShowSidebar' | 'history'>;
type AutomationsProps = Omit<ComponentProps<typeof AutomationsScreen>, 'onShowSidebar' | 'history'>;
type ActivityProps = Omit<ComponentProps<typeof ActivityScreen>, 'onShowSidebar' | 'history'>;
type TemplatesProps = Omit<ComponentProps<typeof TemplatesPage>, 'onShowSidebar' | 'history'>;
type TermsProps = Omit<ComponentProps<typeof TermsPage>, 'onShowSidebar' | 'history'>;

/**
 * The page open over the panes, if any: the graph, a type's page, the query
 * page, the tags, the Archive, the Inbox, the weekly review, the Today page, the Automations, the Activity, the Templates or the Terms page, in that order when more than one
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
  today,
  automations,
  activity,
  templates,
  terms,
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
  /** `vaultKey` keys the page: another vault's Inbox starts afresh, holding its rows for its own offers (#130). */
  inbox: { open: boolean; vaultKey: string | null; page: InboxProps };
  review: { open: boolean; page: ReviewProps };
  today: { open: boolean; page: TodayProps };
  automations: { open: boolean; screen: AutomationsProps };
  activity: { open: boolean; screen: ActivityProps };
  templates: { open: boolean; page: TemplatesProps };
  terms: { open: boolean; page: TermsProps };
  onShowSidebar?: () => void;
  /** The focused pane's Back and Forward: the page is shown in its place. */
  history?: PageHistory;
}): ReactNode | null {
  const sidebar = {
    ...(onShowSidebar !== undefined && { onShowSidebar }),
    ...(history !== undefined && { history }),
  };
  // One frame for every page loaded on first use, so nothing moves when it draws.
  const later = (page: ReactNode) => (
    <Suspense fallback={<PageFrameFallback {...sidebar} />}>{page}</Suspense>
  );
  if (graph.scope !== null) {
    return later(<GraphPage {...graph} scope={graph.scope} {...sidebar} />);
  }
  if (type.table.type !== null) {
    // One editor per type: its queued changes and open question belong to that file.
    return later(<TypePage key={type.table.type.name} {...type} {...sidebar} />);
  }
  if (query.open) return later(<QueryScreen {...query.screen} {...sidebar} />);
  if (tags.selected !== undefined) {
    return later(<TagsScreen {...tags.screen} selected={tags.selected} {...sidebar} />);
  }
  if (archive.open) return later(<ArchivePage {...archive.page} {...sidebar} />);
  if (inbox.open) return <InboxPage key={inbox.vaultKey} {...inbox.page} {...sidebar} />;
  if (review.open) return later(<WeeklyReviewPage {...review.page} {...sidebar} />);
  if (today.open) return <TodayPage {...today.page} {...sidebar} />;
  if (automations.open) return later(<AutomationsScreen {...automations.screen} {...sidebar} />);
  if (activity.open) return later(<ActivityScreen {...activity.screen} {...sidebar} />);
  if (templates.open) return later(<TemplatesPage {...templates.page} {...sidebar} />);
  if (terms.open) return later(<TermsPage {...terms.page} {...sidebar} />);
  return null;
}
