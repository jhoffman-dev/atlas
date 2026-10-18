import { LoadedLater } from '../page-frame-fallback.tsx';
import { weeklyReviewPage } from '../pages-on-first-use.ts';
import { localClock } from '../today.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import { useWeeklyReview } from './use-weekly-review.ts';

const WeeklyReviewPage = weeklyReviewPage.Component;

/**
 * The weekly review as a tab (P30-07, tab-model.md PR B): it reads the
 * week itself, so a change of status draws this and not the window. Its
 * Archive is the app's, for a project.
 */
export function ReviewContainer({ wiring, chrome }: PageContainerProps) {
  const { pages, pane } = wiring;
  const review = useWeeklyReview({
    ports: pages.ports,
    editors: pane.editors,
    clock: localClock,
    types: pane.types,
    indexKey: pane.indexKey,
    indexReady: pages.indexReady,
    open: true,
    onSettled: pages.onSettled,
    archiveNote: (path) => pane.archive.archive([path]),
    activity: pane.activity,
  });
  return (
    <LoadedLater chrome={chrome}>
      <WeeklyReviewPage
        {...review.page}
        onOpen={pages.openNote}
        onOpenInbox={() => pages.openPage({ kind: 'inbox' })}
        {...chrome}
      />
    </LoadedLater>
  );
}
