import type { CSSProperties } from 'react';
import { countOf, legendName } from '@atlas/domain';
import type { WidgetBar } from '@atlas/application';
import { stackedSegments } from '../charts/geometry.ts';
import { useNoteNames } from '../note-names.tsx';
import { CountTable, swatchOf } from './count-table.tsx';

/**
 * The donut kind, answering "how is the whole divided": a thin bar stacked
 * with a segment per value, in the order given, over the same counts as a
 * table. The table is the chart for anyone who cannot see the bar, and lists
 * the values nothing has yet, which get no segment.
 */
export function DonutChart({
  bars,
  groupBy,
  noun,
}: {
  bars: readonly WidgetBar[];
  groupBy: string | null;
  noun: string;
}) {
  const names = useNoteNames();
  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  if (total === 0) return <p className="widget__empty">Nothing to chart yet.</p>;

  const segments = stackedSegments({ values: bars.map((bar) => bar.count), width: 100 });

  return (
    <div className="donut">
      <div className="donut__bar" role="img" aria-label={`${total} in total`}>
        {segments.map((segment, index) => {
          const bar = bars[index];
          if (bar === undefined || segment.size === 0) return null;
          return (
            <span
              // By position: a value genuinely called "Other" must not share a
              // key with the gathered tail.
              key={`${index}-${bar.label}`}
              className="chart-swatch donut__segment"
              {...swatchOf({ index, label: bar.label, groupBy })}
              title={`${legendName(bar.label, names)} · ${countOf(bar.count, noun)}`}
              style={{ '--size': segment.size } as CSSProperties}
            />
          );
        })}
      </div>
      <CountTable bars={bars} groupBy={groupBy} noun={noun} swatches />
    </div>
  );
}
