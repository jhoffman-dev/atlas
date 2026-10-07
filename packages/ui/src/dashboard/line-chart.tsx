import type { CSSProperties } from 'react';
import { groupName } from '@atlas/domain';
import type { WidgetBar } from '@atlas/application';
import { largestOf, linearScale, linePath, niceTicks } from '../charts/geometry.ts';
import { useNoteNames } from '../note-names.tsx';

const WIDTH = 320;
const HEIGHT = 120;
const PADDING = 8;

/**
 * Counts along their keys, for a property that runs in an order — a date, a
 * phase. A smooth line with a dot on the last reading only; the others show
 * their dot when pointed at, so the line is not a string of rings.
 */
export function LineChart({ bars }: { bars: readonly WidgetBar[] }) {
  const names = useNoteNames();
  if (bars.length === 0) return <p className="widget__empty">Nothing to chart yet.</p>;

  const highest = largestOf(bars.map((bar) => bar.count));
  const ticks = niceTicks({ max: highest });
  const top = ticks[ticks.length - 1] ?? 1;
  const { path, points } = linePath({
    values: bars.map((bar) => bar.count),
    width: WIDTH,
    height: HEIGHT,
    max: top,
    padding: PADDING,
    smooth: true,
  });
  // The same scale the line was drawn with, so the gridlines are where it is read.
  const toY = linearScale({ domain: [0, top], range: [HEIGHT - PADDING, PADDING] });

  return (
    <div className="line-chart">
      <div className="line-chart__box">
        <svg
          className="line-chart__plot"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${bars.length} points, highest ${highest}`}
        >
          {ticks.map((tick) => (
            <line
              key={tick}
              className="line-chart__grid"
              x1="0"
              x2={WIDTH}
              y1={toY(tick)}
              y2={toY(tick)}
            />
          ))}
          <path className="line-chart__line" d={path} />
        </svg>
        {/* Dots are HTML over the stretched SVG, so they stay round at any width. */}
        {points.map((point, index) => (
          <span
            key={bars[index]?.label ?? index}
            className={
              index === points.length - 1
                ? 'line-chart__point line-chart__point--last'
                : 'line-chart__point'
            }
            title={`${groupName(bars[index]?.label ?? '', names)}: ${bars[index]?.count ?? ''}`}
            style={
              {
                '--x': `${(point.x / WIDTH) * 100}%`,
                '--y': `${(point.y / HEIGHT) * 100}%`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      {/* A table rather than a caption: the numbers are the point, and a screen
          reader gets them in the same order the line draws them. */}
      <table className="line-chart__values">
        <tbody>
          <tr>
            {bars.map((bar) => (
              <th scope="col" key={bar.label}>
                {groupName(bar.label, names)}
              </th>
            ))}
          </tr>
          <tr>
            {bars.map((bar) => (
              <td key={bar.label}>{bar.count}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
