import type { NoteTemplate } from '@atlas/application';
import { useNoticeActivity } from '../activity/use-activity-log.ts';
import { LoadedLater } from '../page-frame-fallback.tsx';
import { termsPage } from '../pages-on-first-use.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import { useIndexKey } from '../index/index-status-store.ts';
import { useTermsPage } from './use-terms-page.ts';

const TermsPage = termsPage.Component;

/** What the Terms page needs from the window beyond what every page is handed. */
export interface TermsWiring {
  /** The vault's templates, which a new term is made from. */
  readonly templates: readonly NoteTemplate[];
}

/**
 * The Terms page as a tab (tab-model.md, PR B): it reads the terms and the
 * vocabulary itself. A write it gives up on is said over the page, as the
 * window said it, and kept in the Activity log once.
 */
export function TermsContainer({ wiring, chrome }: PageContainerProps) {
  const { pages, pane } = wiring;
  // Still read again on every news of the index: what it reads is not yet scoped (#325).
  const indexKey = useIndexKey(pane.indexStatus, pane.vault);
  const { page, notice } = useTermsPage({
    ports: {
      index: pane.index,
      fs: pages.ports.fs,
      markdown: pane.notes.markdown,
      editors: pane.editors,
    },
    open: true,
    indexKey,
    types: pane.types,
    templates: pages.terms.templates,
    notePaths: pane.notePaths,
    onChanged: pane.onChanged,
    activity: pane.activity,
  });
  useNoticeActivity({ errors: [notice], warnings: [] }, pane.activity);
  return (
    <LoadedLater chrome={chrome}>
      {notice !== null && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <TermsPage {...page} onOpen={pages.openNote} {...chrome} />
    </LoadedLater>
  );
}
