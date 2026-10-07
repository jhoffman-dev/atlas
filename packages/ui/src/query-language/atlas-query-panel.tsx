import type { ReactNode } from 'react';
import type { ViewLayout } from '@atlas/domain';
import type { Choice } from '../choice-select.tsx';
import type { OverlaySlots } from '../overlay-slot.ts';
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
  /** A view's own actions — Save and Reset while it differs from its file. */
  readonly pending?: ReactNode;
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
      <QueryComposer {...props.composer} />
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
        {props.pending}
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
