import type { FailedPartProps } from './on-first-use.ts';
import { PageFrameFallback, type PageChrome } from './page-frame-fallback.tsx';

/** A part whose chunk could not be loaded: a quiet line and the way to try again. */
export function PartFailed({ retrying, onRetry }: Omit<FailedPartProps<unknown>, 'props'>) {
  return (
    <div className="viewer" role="alert">
      <p>This part couldn’t load.</p>
      <button type="button" className="btn btn--sm" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Reloading…' : 'Reload'}
      </button>
    </div>
  );
}

/** A page whose chunk could not be loaded: the same, inside the page's frame. */
export function PageFailed({ props, retrying, onRetry }: FailedPartProps<PageChrome>) {
  return (
    <PageFrameFallback
      {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
      {...(props.history !== undefined && { history: props.history })}
    >
      <PartFailed retrying={retrying} onRetry={onRetry} />
    </PageFrameFallback>
  );
}
