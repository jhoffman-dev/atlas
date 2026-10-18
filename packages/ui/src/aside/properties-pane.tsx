import { useState } from 'react';
import { isEmptyProperty } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { Key } from '../key-hints.tsx';
import { PropertiesPanel } from '../properties-panel.tsx';

type PanelProps = Parameters<typeof PropertiesPanel>[0];

/**
 * The aside's Properties tab (FlowTable.dc.html): a kicker saying what is
 * shown and its title, the filled properties as 30px rows with 92px labels,
 * the empty ones folded behind "N empty properties" (brief rule 5: hide
 * empty values), a Summary, and Open / New tab at the foot.
 *
 * The rows are the page's own `PropertiesPanel`, so every editor keeps its
 * commit rules and writes through the one `onChange` the page's panel uses;
 * two live editors for one note are already handled per pane. The fold is
 * the only state here, and it is the pane's alone.
 */
export function PropertiesPane({
  context,
  title,
  summary = null,
  onOpen,
  onOpenInNewTab,
  rows,
  ...panel
}: PanelProps & {
  /** What the aside is showing, read above the title: "Task · selected row". */
  context: string;
  title: string;
  /** The note's first words, read under the rows; null for none. */
  summary?: string | null;
  /** Opens what is shown in the pane; left out where it is already open. */
  onOpen?: () => void;
  /** Opens what is shown in a new tab; left out where the app has no tab to give. */
  onOpenInNewTab?: () => void;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const empty = rows.filter((row) => isEmptyProperty(row.value));
  const shown = unfolded ? rows : rows.filter((row) => !isEmptyProperty(row.value));
  const count = `${empty.length} empty ${empty.length === 1 ? 'property' : 'properties'}`;

  return (
    <div className="aside-props">
      <header className="aside__head">
        <span className="aside__kicker">{context}</span>
        <h2 className="aside__title">{title}</h2>
      </header>
      <div className="aside-props__rows">
        <PropertiesPanel {...panel} rows={shown} />
        {empty.length > 0 && (
          <button
            type="button"
            className="aside-props__fold"
            aria-expanded={unfolded}
            onClick={() => setUnfolded((was) => !was)}
          >
            {unfolded ? `Hide ${count}` : count}
          </button>
        )}
      </div>
      {summary !== null && summary.trim() !== '' && (
        <section className="aside__block" aria-label="Summary">
          <span className="aside__kicker">Summary</span>
          <p className="aside__summary">{summary}</p>
        </section>
      )}
      {(onOpen !== undefined || onOpenInNewTab !== undefined) && (
        <footer className="aside__foot">
          {onOpen !== undefined && (
            <button
              type="button"
              className="btn btn--secondary aside__foot-button"
              onClick={onOpen}
            >
              <Icon name="arrow" size={13} />
              Open
              <span aria-hidden="true">
                <Key>Space</Key>
              </span>
            </button>
          )}
          {onOpenInNewTab !== undefined && (
            <button
              type="button"
              className="btn btn--secondary aside__foot-button"
              onClick={onOpenInNewTab}
            >
              New tab
              <span aria-hidden="true">
                <Key>⌘↵</Key>
              </span>
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
