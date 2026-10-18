import type { CSSProperties } from 'react';
import { groupName, humanizeKey, pluralOf } from '@atlas/domain';
import type { RankData } from '@atlas/application';
import { useNoteNames } from '../note-names.tsx';

/**
 * The largest groups, largest first, as rows: the group, a thin bar against
 * the largest, and its count under a heading that names what is counted. The
 * called-out group's bar is the pastel blue. The panel's head says how much
 * of the whole the rows hold, as "96 of 177 tasks".
 */
export function RankList({
  data,
  groupBy,
  noun,
}: {
  data: RankData;
  groupBy: string;
  noun: string;
}) {
  const names = useNoteNames();
  if (data.rows.length === 0) return <p className="widget__empty">Nothing to rank yet.</p>;

  const counted = noun === '' ? 'Count' : humanizeKey(pluralOf(noun));

  return (
    <table className="rank">
      <thead>
        <tr>
          <th scope="col">{humanizeKey(groupBy)}</th>
          <th scope="col" aria-hidden="true">
            {`Share of ${noun === '' ? 'the whole' : pluralOf(noun)}`}
          </th>
          <th scope="col" className="rank__num">
            {counted}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, index) => (
          <tr
            className={row.label === data.highlight ? 'rank__row rank__row--current' : 'rank__row'}
            // By position: a label can repeat.
            key={`${index}-${row.label}`}
          >
            <td className="rank__name">{`${humanizeKey(groupBy)} ${groupName(row.label, names)}`}</td>
            <td className="rank__track" aria-hidden="true">
              <span
                className="rank__bar"
                style={{ '--at': `${row.fraction * 100}%` } as CSSProperties}
              />
            </td>
            <td className="rank__count">{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
