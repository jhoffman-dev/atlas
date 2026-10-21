import {
  humanizeKey,
  isKnownStatus,
  legendName,
  pluralOf,
  statusTone,
  type StatusTone,
} from '@dfai/domain';
import type { WidgetBar } from '@dfai/application';
import { useNoteNames } from '../note-names.tsx';

/**
 * Which colour a group's swatch wears, as data attributes for the stylesheet:
 * its rank among the groups, and, when the groups are statuses and the group
 * is a status the ramp knows — one of the seven tones, an alias, a GTD status
 * — the status itself, so Done is green here as it is in every pill. A value
 * that is no status — a custom option, the gathered "Other", no value at all
 * — keeps its rank colour: `statusTone` falls back to Backlog for anything
 * it does not know, and two groups must not share a colour.
 */
export function swatchOf({
  index,
  label,
  groupBy,
}: {
  index: number;
  label: string;
  groupBy: string | null;
}): { readonly 'data-rank': number; readonly 'data-tone'?: StatusTone } {
  const tone: StatusTone | null =
    groupBy === 'status' && isKnownStatus(label) ? statusTone(label) : null;
  return { 'data-rank': index + 1, ...(tone !== null && { 'data-tone': tone }) };
}

/**
 * Counts as a table — a group, how many, and its share of the whole — in the
 * order the chart draws them, so a reader of either gets the same picture.
 * With `swatches`, each row leads with the dot its segment is painted in. A
 * group nothing is in yet is still listed, faintly, so a stage nobody is in
 * still reads as a stage.
 */
export function CountTable({
  bars,
  groupBy,
  noun,
  highlight = null,
  swatches = false,
}: {
  bars: readonly WidgetBar[];
  groupBy: string | null;
  noun: string;
  /** The group the chart calls out: its row is marked, so the table says what the bars said. */
  highlight?: string | null;
  swatches?: boolean;
}) {
  const names = useNoteNames();
  return (
    <table className="count-table">
      <thead>
        <tr>
          <th scope="col">{groupBy === null ? 'Value' : humanizeKey(groupBy)}</th>
          <th scope="col" className="count-table__num">
            {noun === '' ? 'Count' : humanizeKey(pluralOf(noun))}
          </th>
          <th scope="col" className="count-table__num">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {bars.map((bar, index) => (
          <tr
            // By position: a value genuinely called "Other" must not share a
            // key with the gathered tail.
            key={`${index}-${bar.label}`}
            className={[
              'count-table__row',
              bar.count === 0 ? 'count-table__row--empty' : '',
              bar.label === highlight ? 'count-table__row--current' : '',
            ]
              .filter((name) => name !== '')
              .join(' ')}
            {...(bar.label === highlight && { 'aria-current': true })}
          >
            <td className="count-table__label">
              {swatches && (
                <span
                  className="chart-swatch count-table__swatch"
                  {...swatchOf({ index, label: bar.label, groupBy })}
                  aria-hidden="true"
                />
              )}
              {legendName(bar.label, names)}
            </td>
            <td className="count-table__count">{bar.count}</td>
            <td className="count-table__share">{bar.share}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
