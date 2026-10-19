import { useState } from 'react';
import { isEmptyProperty, type VaultPath } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { Key } from '../key-hints.tsx';
import { PropertiesPanel, type PropertyRow } from '../properties-panel.tsx';

type PanelProps = Parameters<typeof PropertiesPanel>[0];

/** The keys whose rows hold nothing, as a fold decides them once per note. */
const emptyKeys = (rows: readonly PropertyRow[]): ReadonlySet<string> =>
  new Set(rows.filter((row) => isEmptyProperty(row.value)).map((row) => row.def.key));

/**
 * The aside's Properties tab (FlowTable.dc.html): a kicker saying what is
 * shown and its title, the filled properties as 30px rows with 92px labels,
 * the empty ones folded behind "N empty properties" (brief rule 5: hide
 * empty values), a Summary, and Open / New tab at the foot.
 *
 * The rows are the page's own `PropertiesPanel`, so every editor keeps its
 * commit rules and writes through the one `onChange` the page's panel uses;
 * two live editors for one note are already handled per pane. Which rows
 * the fold hides is decided when the note changes, not on every render: a
 * row cleared while it is being edited stays on screen with its focus, and a
 * property just added is drawn the moment it arrives, empty as it is. A row
 * decided empty that is then filled shows too — the fold hides nothing with
 * a value in it.
 */
export function PropertiesPane({
  context,
  title,
  path,
  summary = null,
  onOpen,
  onOpenInNewTab,
  rows,
  ...panel
}: PanelProps & {
  /** What the aside is showing, read above the title: "Task · selected row". */
  context: string;
  title: string;
  /**
   * The note the rows belong to. The fold is decided afresh when it changes,
   * in the same render, so the caller changes `path` and `rows` together: a
   * new path with the old rows would fold the old note's empties.
   */
  path: VaultPath;
  /** The note's first words, read under the rows; null for none. */
  summary?: string | null;
  /** Opens what is shown in the pane; left out where it is already open. */
  onOpen?: () => void;
  /** Opens what is shown in a new tab; left out where the app has no tab to give. */
  onOpenInNewTab?: () => void;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const [decided, setDecided] = useState(() => ({ path, keys: emptyKeys(rows) }));
  if (decided.path !== path) {
    // Derived from the note: decided again as it changes, during the render
    // that first sees it (with the rows that came with it), which React
    // re-runs at once with the new state.
    setDecided({ path, keys: emptyKeys(rows) });
    setUnfolded(false);
  }
  const folded = rows
    .filter((row) => decided.keys.has(row.def.key) && isEmptyProperty(row.value))
    .map((row) => row.def.key);
  const count = `${folded.length} empty ${folded.length === 1 ? 'property' : 'properties'}`;

  return (
    <div className="aside-props">
      <header className="aside__head">
        <span className="aside__kicker">{context}</span>
        <h2 className="aside__title">{title}</h2>
      </header>
      <div className="aside-props__rows">
        <PropertiesPanel {...panel} rows={rows} folded={unfolded ? [] : folded} />
        {folded.length > 0 && (
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
