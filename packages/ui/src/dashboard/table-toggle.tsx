import { Icon } from '../icon.tsx';

/**
 * A chart's way of being read as numbers: pressed, the widget draws its
 * counts as a table instead of a picture. The choice is the widget's for as
 * long as it is on the page and is not written anywhere (Q9).
 */
export function TableToggle({
  showingTable,
  onToggle,
}: {
  showingTable: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="icon-button widget__toggle"
      aria-label="Show as table"
      aria-pressed={showingTable}
      onClick={onToggle}
    >
      <Icon name={showingTable ? 'chart' : 'table'} size={14} />
    </button>
  );
}
