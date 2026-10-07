import { AtlasQueryPanel, ViewSaveControls, ViewTabs, type OverlaySlots } from '@atlas/ui';
import type { QueryViewState } from '../query/use-query-view.ts';

/**
 * A saved Atlas query as a page (P24-04): the other saved queries as tabs,
 * then the query and its answer. Save and Reset appear while the query or its
 * layout differs from the file.
 */
export function QueryViewBody({
  view,
  onOpenView,
  popups,
}: {
  view: QueryViewState;
  onOpenView: (path: string) => void;
  popups?: OverlaySlots;
}) {
  return (
    <div className="query-view">
      <div className="view-toolbar">
        <ViewTabs tabs={view.tabs} onOpenView={onOpenView} />
      </div>
      <AtlasQueryPanel
        {...view.panel}
        {...(popups !== undefined && { popups })}
        pending={
          view.edited ? (
            <ViewSaveControls
              suggestedName={view.suggestedName}
              error={view.saveError}
              onSave={view.save}
              onSaveAs={view.saveAs}
              onReset={view.reset}
              slot={popups?.('save-as-view')}
            />
          ) : null
        }
      />
    </div>
  );
}
