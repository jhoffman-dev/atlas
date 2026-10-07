import { useState } from 'react';
import {
  showsType,
  toggleGraphType,
  UNTYPED,
  type GraphDepth,
  type GraphFilter,
  type StatusTone,
  type VaultGraph,
  type VaultPath,
} from '@atlas/domain';
import { PageBar, type PageHistory } from '../page-bar.tsx';
import { PageHead } from '../page-head.tsx';
import { SegmentedControl } from '../segmented-control.tsx';
import { Toggle } from '../toggle.tsx';
import { GraphCanvas, type OpenRequest } from './graph-canvas.tsx';
import { GraphList } from './graph-list.tsx';

type Showing = 'graph' | 'list';

const SHOWING = [
  { value: 'graph', label: 'Graph' },
  { value: 'list', label: 'List' },
] as const;

const DEPTHS = [
  { value: '1', label: '1 step' },
  { value: '2', label: '2 steps' },
] as const;

/** What the page draws: the graph and how many notes were left out of it, or why there is none. */
export type GraphContent =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly graph: VaultGraph; readonly hidden: number };

export interface GraphViewProps {
  content: GraphContent;
  /** The note a local graph is drawn around; null for the whole vault. */
  centre: { readonly path: VaultPath; readonly title: string; readonly depth: GraphDepth } | null;
  /** Every type in the vault, `UNTYPED` among them when some note has none. */
  types: readonly string[];
  typeLabel: (type: string | null) => string;
  tones: ReadonlyMap<string, StatusTone>;
  filter: GraphFilter;
  onFilterChange: (filter: GraphFilter) => void;
  onDepthChange: (depth: GraphDepth) => void;
  /** From a local graph back to the whole vault. */
  onShowVault: () => void;
  onOpen: (path: VaultPath, request: OpenRequest) => void;
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * The graph page: how the vault's notes connect — all of them, or those
 * around one note — drawn as a force layout or listed, with the controls
 * that narrow it.
 */
export function GraphView(props: GraphViewProps) {
  const { content, centre } = props;
  const [showing, setShowing] = useState<Showing>('graph');
  const name = centre === null ? 'Graph' : `Around ${centre.title}`;

  return (
    <>
      <PageBar
        crumb={{ icon: 'graph', parent: 'Graph' }}
        name={centre === null ? 'Whole vault' : centre.title}
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body panel__body--graph">
        <article className="page page--wide graph" aria-label={name}>
          <PageHead
            icon="graph"
            title={name}
            description={describe(content)}
            actions={
              <SegmentedControl
                label="Show as"
                options={SHOWING}
                value={showing}
                onChange={setShowing}
              />
            }
          >
            <GraphControls {...props} />
          </PageHead>
          {content.kind === 'ready' && content.hidden > 0 && (
            <p className="graph__notice" role="status">
              Showing the {content.graph.nodes.length} most connected notes; {content.hidden} more
              are left out to keep the graph responsive. Narrow it by type to see them.
            </p>
          )}
          <GraphBody {...props} showing={showing} />
        </article>
      </div>
    </>
  );
}

function describe(content: GraphContent): string | null {
  if (content.kind !== 'ready') return null;
  const { nodes, edges } = content.graph;
  return `${nodes.length} ${nodes.length === 1 ? 'note' : 'notes'} · ${edges.length} ${
    edges.length === 1 ? 'connection' : 'connections'
  }`;
}

function GraphBody(props: GraphViewProps & { showing: Showing }) {
  const { content } = props;
  if (content.kind === 'loading') return <p className="graph__empty">Reading the vault…</p>;
  if (content.kind === 'failed') {
    return (
      <p className="graph__empty graph__empty--error" role="alert">
        {content.message}
      </p>
    );
  }
  if (props.showing === 'list') {
    return <GraphList graph={content.graph} typeLabel={props.typeLabel} onOpen={props.onOpen} />;
  }
  if (content.graph.nodes.length === 0) {
    return <p className="graph__empty">No notes match these filters.</p>;
  }
  return (
    <div className="graph__stage">
      <GraphCanvas
        graph={content.graph}
        tones={props.tones}
        centre={props.centre?.path ?? null}
        onOpen={props.onOpen}
      />
    </div>
  );
}

/** Types as chips, the switches, and — around one note — how far to reach. */
function GraphControls({
  types,
  typeLabel,
  tones,
  filter,
  onFilterChange,
  centre,
  onDepthChange,
  onShowVault,
}: GraphViewProps) {
  return (
    <div className="graph__controls">
      <div className="graph__chips" role="group" aria-label="Types">
        {types.map((type) => (
          <button
            key={type === UNTYPED ? '(none)' : type}
            type="button"
            className="graph__chip"
            aria-pressed={showsType(filter, type)}
            onClick={() => onFilterChange(toggleGraphType(filter, { type, all: types }))}
          >
            <span
              className="graph__swatch"
              data-tone={tones.get(type) ?? 'none'}
              aria-hidden="true"
            />
            {typeLabel(type === UNTYPED ? null : type)}
          </button>
        ))}
      </div>
      <div className="graph__switches">
        <label className="graph__switch">
          <Toggle
            label="Hide orphans"
            checked={filter.hideOrphans}
            onChange={(hideOrphans) => onFilterChange({ ...filter, hideOrphans })}
          />
          <span aria-hidden="true">Hide orphans</span>
        </label>
        <label className="graph__switch">
          <Toggle
            label="Show system notes"
            checked={!filter.hideSystem}
            onChange={(show) => onFilterChange({ ...filter, hideSystem: !show })}
          />
          <span aria-hidden="true">System notes</span>
        </label>
        <label className="graph__switch">
          <Toggle
            label="Show archived notes"
            checked={!filter.hideArchived}
            onChange={(show) => onFilterChange({ ...filter, hideArchived: !show })}
          />
          <span aria-hidden="true">Archived</span>
        </label>
        {centre !== null && (
          <>
            <SegmentedControl
              label="Depth"
              tone="quiet"
              options={DEPTHS}
              value={String(centre.depth) as '1' | '2'}
              onChange={(depth) => onDepthChange(depth === '2' ? 2 : 1)}
            />
            <button type="button" className="btn btn--ghost" onClick={onShowVault}>
              Whole vault
            </button>
          </>
        )}
      </div>
    </div>
  );
}
