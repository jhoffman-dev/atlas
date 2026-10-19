import { Suspense, type ComponentProps, type ReactNode } from 'react';
import type { NavigationPlace } from '@atlas/domain';
import { InboxPage, TodayPage } from '@atlas/ui';
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
import { PageFrameFallback, type PageChrome } from './page-frame-fallback.tsx';

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

type Chrome = 'onShowSidebar' | 'history';
type GraphProps = Omit<ComponentProps<typeof GraphPage>, 'scope' | Chrome>;
type TypeProps = Omit<ComponentProps<typeof TypePage>, Chrome>;
type QueryProps = Omit<ComponentProps<typeof QueryScreen>, Chrome>;
type TagsProps = Omit<ComponentProps<typeof TagsScreen>, 'selected' | Chrome>;
type ArchiveProps = Omit<ComponentProps<typeof ArchivePage>, Chrome>;
type InboxProps = Omit<ComponentProps<typeof InboxPage>, Chrome>;
type ReviewProps = Omit<ComponentProps<typeof WeeklyReviewPage>, Chrome>;
type TodayProps = Omit<ComponentProps<typeof TodayPage>, Chrome>;
type AutomationsProps = Omit<ComponentProps<typeof AutomationsScreen>, Chrome>;
type ActivityProps = Omit<ComponentProps<typeof ActivityScreen>, Chrome>;
type TemplatesProps = Omit<ComponentProps<typeof TemplatesPage>, Chrome>;
type TermsProps = Omit<ComponentProps<typeof TermsPage>, Chrome>;

/** A place that is a page rather than a note: what `pageForPlace` draws. */
export type PagePlace = Exclude<NavigationPlace, { kind: 'note' }>;

/**
 * Every page's props, assembled by `App` once for the window (tab-model.md,
 * PR A) and handed down to the tab that shows the page. One of each: a type
 * page draws only when its table is the type the tab names.
 */
export interface PageProps {
  graph: GraphProps;
  /** The table of the one type whose page is assembled; a type that is gone shows nothing. */
  type: TypeProps;
  query: QueryProps;
  tags: TagsProps;
  archive: ArchiveProps;
  /** `vaultKey` keys the page: another vault's Inbox starts afresh, holding its rows for its own offers (#130). */
  inbox: InboxProps & { readonly vaultKey: string | null };
  review: ReviewProps;
  today: TodayProps;
  automations: AutomationsProps;
  activity: ActivityProps;
  templates: TemplatesProps;
  terms: TermsProps;
}

/**
 * The page a tab's place names, drawn with that tab's Back and Forward and,
 * in the first pane while the sidebar is hidden, the way back to it. A page
 * loaded on first use draws its frame first, so nothing moves when it lands.
 */
export function pageForPlace({
  place,
  pages,
  chrome,
}: {
  place: PagePlace;
  pages: PageProps;
  chrome: PageChrome;
}): ReactNode {
  const later = (page: ReactNode) => (
    <Suspense fallback={<PageFrameFallback {...chrome} />}>{page}</Suspense>
  );
  switch (place.kind) {
    case 'graph':
      return later(<GraphPage {...pages.graph} scope={place.scope} {...chrome} />);
    case 'type': {
      const { table } = pages.type;
      if (table.type === null || table.type.name !== place.name) {
        return <PageFrameFallback {...chrome} />;
      }
      // One editor per type: its queued changes and open question belong to that file.
      return later(<TypePage key={place.name} {...pages.type} {...chrome} />);
    }
    case 'query':
      return later(<QueryScreen {...pages.query} {...chrome} />);
    case 'tags':
      return later(<TagsScreen {...pages.tags} selected={place.tag} {...chrome} />);
    case 'archive':
      return later(<ArchivePage {...pages.archive} {...chrome} />);
    case 'inbox': {
      const { vaultKey, ...inbox } = pages.inbox;
      return <InboxPage key={vaultKey} {...inbox} {...chrome} />;
    }
    case 'review':
      return later(<WeeklyReviewPage {...pages.review} {...chrome} />);
    case 'today':
      return <TodayPage {...pages.today} {...chrome} />;
    case 'automations':
      return later(<AutomationsScreen {...pages.automations} {...chrome} />);
    case 'activity':
      return later(<ActivityScreen {...pages.activity} {...chrome} />);
    case 'templates':
      return later(<TemplatesPage {...pages.templates} {...chrome} />);
    case 'terms':
      return later(<TermsPage {...pages.terms} {...chrome} />);
  }
}
