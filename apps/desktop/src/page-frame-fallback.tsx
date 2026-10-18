import type { ReactNode } from 'react';
import { PageBar, type PageHistory } from '@atlas/ui';

/** What a page's frame keeps from the page: the way back to the sidebar, and Back and Forward. */
export interface PageChrome {
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * What a page loaded on first use shows while its chunk arrives: the page's own
 * frame — its bar, with Back and Forward where they will be, over an empty
 * body — so nothing moves when the page draws into it. Given children, the
 * body holds them instead.
 */
export function PageFrameFallback({
  onShowSidebar,
  history,
  children,
}: PageChrome & { children?: ReactNode }) {
  return (
    <>
      <PageBar
        crumb={null}
        name={null}
        {...(onShowSidebar !== undefined && { onShowSidebar })}
        {...(history !== undefined && { history })}
      />
      <div className="panel__body" {...(children === undefined && { 'aria-busy': true })}>
        {children}
      </div>
    </>
  );
}
