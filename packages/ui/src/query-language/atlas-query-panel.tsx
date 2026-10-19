import { useId } from 'react';
import type { ViewLayout } from '@atlas/domain';
import type { Choice } from '../choice-select.tsx';
import type { OverlaySlots } from '../overlay-slot.ts';
import type { QueryPanelFold } from '../query-panel-fold.ts';
import { SegmentedControl } from '../segmented-control.tsx';
import { GroupedResult, type GroupedResultProps } from './grouped-result.tsx';
import {
  AddQueryToDashboardPopover,
  SaveQueryPopover,
  type AddQueryToDashboard,
  type SaveQuery,
} from './keep-query.tsx';
import { QueryComposer, type QueryComposerProps } from './query-composer.tsx';

export interface AtlasQueryPanelProps {
  readonly composer: QueryComposerProps;
  readonly layout: ViewLayout;
  readonly layouts: readonly Choice<ViewLayout>[];
  readonly onLayout: (layout: ViewLayout) => void;
  /** The last answer, drawn in the layout; null before one has come back. */
  readonly result: Omit<GroupedResultProps, 'layout'> | null;
  /** True when the row limit stopped the answer short. */
  readonly truncated: boolean;
  /** Why the index could not answer, in its words. */
  readonly error: string | null;
  /** "Save as view": offered where the query is not a view yet. */
  readonly save?: SaveQuery;
  readonly dashboards: AddQueryToDashboard;
  /**
   * A saved view folds its query to one line and opens it to edit; the query
   * page, where the query is the work, has no fold and draws the editor open.
   */
  readonly fold?: QueryPanelFold;
  readonly popups?: OverlaySlots;
}

/**
 * An Atlas query and its answer: the builder or the text, the layout, the ways
 * to keep it, and the rows in their groups. The query page and a saved query
 * view both draw this; only what "keep" means differs.
 */
export function AtlasQueryPanel(props: AtlasQueryPanelProps) {
  return (
    <div className="aquery">
      {props.fold === undefined ? (
        <QueryComposer {...props.composer} />
      ) : (
        <FoldedComposer composer={props.composer} fold={props.fold} />
      )}
      <div className="aquery__bar">
        <SegmentedControl
          label="Layout"
          options={props.layouts}
          value={props.layout}
          onChange={props.onLayout}
        />
        {props.result !== null && (
          <span className="query__count" role="status">
            {countOf(props.result.rows.length, props.truncated)}
          </span>
        )}
        <span className="query__spacer" />
        {props.save !== undefined && (
          <SaveQueryPopover save={props.save} slot={props.popups?.('save-query')} />
        )}
        <AddQueryToDashboardPopover
          dashboards={props.dashboards}
          slot={props.popups?.('add-query')}
        />
      </div>
      <Answer {...props} />
    </div>
  );
}

/**
 * The composer behind a disclosure: folded, one monospace line of the query
 * and "Edit query"; open, the composer itself and "Hide query". The editor is
 * not drawn while folded, so none of its fields is there to tab into.
 */
function FoldedComposer({
  composer,
  fold,
}: {
  composer: QueryComposerProps;
  fold: QueryPanelFold;
}) {
  const id = useId();
  return (
    <div className={`aquery__fold${fold.collapsed ? ' aquery__fold--shut' : ''}`}>
      <div id={id} className="aquery__fold-body">
        {fold.collapsed ? (
          <code className="aquery__fold-text">
            {composer.text.trim() === '' ? 'No query yet' : composer.text}
          </code>
        ) : (
          <QueryComposer {...composer} />
        )}
      </div>
      <button
        type="button"
        className="btn btn--ghost aquery__fold-toggle"
        aria-expanded={!fold.collapsed}
        aria-controls={id}
        onClick={fold.onToggle}
      >
        {fold.collapsed ? 'Edit query' : 'Hide query'}
      </button>
    </div>
  );
}

function Answer({ result, error, layout }: AtlasQueryPanelProps) {
  if (error !== null) {
    return (
      <p className="query__error" role="alert">
        {error}
      </p>
    );
  }
  if (result === null)
    return <p className="query__hint">Pick what to list, or write it as text.</p>;
  return <GroupedResult layout={layout} {...result} />;
}

function countOf(count: number, truncated: boolean): string {
  const notes = `${count} ${count === 1 ? 'note' : 'notes'}`;
  return truncated ? `${notes} (more were left out)` : notes;
}
