import { PageBar, type PageHistory } from '@atlas/ui';

/**
 * What a page loaded on first use shows while its chunk arrives: the page's own
 * frame — its bar, with Back and Forward where they will be, over an empty
 * body — so nothing moves when the page draws into it.
 */
export function PageFrameFallback({
  onShowSidebar,
  history,
}: {
  onShowSidebar?: () => void;
  history?: PageHistory;
}) {
  return (
    <>
      <PageBar
        crumb={null}
        name={null}
        {...(onShowSidebar !== undefined && { onShowSidebar })}
        {...(history !== undefined && { history })}
      />
      <div className="panel__body" aria-busy="true" />
    </>
  );
}
