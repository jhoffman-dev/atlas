import type { CSSProperties } from 'react';
import { countOf, groupName, humanizeKey, percentOf } from '@atlas/domain';
import type { RankData } from '@atlas/application';
import { useNoteNames } from '../note-names.tsx';

/**
 * The largest groups, largest first: a numbered tile, the group, its count and
 * a thin bar against the largest. The header says how much of the whole they
 * hold, as "96 of 177" and a bar.
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

  return (
    <>
      <span className="rank__whole" aria-hidden="true">
        <span
          className="rank__whole-bar"
          style={{ '--at': `${percentOf(data.shown, data.total)}%` } as CSSProperties}
        />
      </span>
      <ol className="rank">
        {data.rows.map((row) => (
          <li
            className={row.label === data.highlight ? 'rank__row rank__row--current' : 'rank__row'}
            key={row.label}
          >
            <span className="rank__tile" aria-hidden="true">
              {groupName(row.label, names)}
            </span>
            <span className="rank__body">
              <span className="rank__line">
                <span className="rank__name">
                  {humanizeKey(groupBy)} {groupName(row.label, names)}
                </span>
                <span className="rank__count">{countOf(row.count, noun)}</span>
              </span>
              <span className="rank__track" aria-hidden="true">
                <span
                  className="rank__bar"
                  style={{ '--at': `${row.fraction * 100}%` } as CSSProperties}
                />
              </span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
