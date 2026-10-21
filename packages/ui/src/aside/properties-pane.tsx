import type { VaultPath } from '@atlas/domain';
import { useEmptyFold } from '../empty-fold.ts';
import { Icon } from '../icon.tsx';
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
 * `useEmptyFold`'s, as the peek's strip folds them.
 */
export function PropertiesPane({
  context,
  title,
  path,
  summary = null,
  onOpen,
  onOpenInNewTab,
  onMergeInto,
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
  /** Given for a person: asks which person to merge them into (#464). */
  onMergeInto?: () => void;
}) {
  const fold = useEmptyFold(path, rows);
  const count = `${fold.count} empty ${fold.count === 1 ? 'property' : 'properties'}`;

  return (
    <div className="aside-props">
      <header className="aside__head">
        <span className="aside__kicker">{context}</span>
        <h2 className="aside__title">{title}</h2>
      </header>
      <div className="aside-props__rows">
        <PropertiesPanel {...panel} rows={rows} folded={fold.folded} />
        {fold.count > 0 && (
          <button
            type="button"
            className="aside-props__fold"
            aria-expanded={fold.unfolded}
            onClick={fold.toggle}
          >
            {fold.unfolded ? `Hide ${count}` : count}
          </button>
        )}
      </div>
      {summary !== null && summary.trim() !== '' && (
        <section className="aside__block" aria-label="Summary">
          <span className="aside__kicker">Summary</span>
          <p className="aside__summary">{summary}</p>
        </section>
      )}
      {(onOpen !== undefined || onOpenInNewTab !== undefined || onMergeInto !== undefined) && (
        <footer className="aside__foot">
          {onOpen !== undefined && (
            <button
              type="button"
              className="btn btn--secondary aside__foot-button"
              onClick={onOpen}
            >
              <Icon name="arrow" size={13} />
              Open
            </button>
          )}
          {onOpenInNewTab !== undefined && (
            <button
              type="button"
              className="btn btn--secondary aside__foot-button"
              onClick={onOpenInNewTab}
            >
              New tab
            </button>
          )}
          {onMergeInto !== undefined && (
            <button
              type="button"
              className="btn btn--secondary aside__foot-button"
              onClick={onMergeInto}
            >
              Merge into…
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
