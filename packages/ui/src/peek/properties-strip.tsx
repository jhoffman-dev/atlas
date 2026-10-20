import { useEmptyFold } from '../empty-fold.ts';
import { PropertiesPanel } from '../properties-panel.tsx';

type PanelProps = Parameters<typeof PropertiesPanel>[0];

/**
 * A note's properties as one quiet line under its title (brief §5.1,
 * FlowPeek.dc.html): the filled ones, label then value, and "+ N empty" to
 * reveal the rest. The peek heads its note with it, and a page with the
 * right sidebar hidden can too.
 *
 * The values are the page's own `PropertiesPanel` editors, so each keeps its
 * commit rules and writes through the one `onChange` the page uses.
 */
export function PropertiesStrip({
  path,
  rows,
  ...panel
}: Omit<PanelProps, 'folded'> & {
  /** The note the rows belong to: the fold is decided afresh when it changes. */
  path: string;
}) {
  const fold = useEmptyFold(path, rows);
  return (
    <div className="props-strip">
      <PropertiesPanel {...panel} rows={rows} folded={fold.folded} />
      {fold.count > 0 && (
        <button
          type="button"
          className="props-strip__fold"
          aria-expanded={fold.unfolded}
          onClick={fold.toggle}
        >
          {fold.unfolded ? 'Hide empty' : `+ ${fold.count} empty`}
        </button>
      )}
    </div>
  );
}
