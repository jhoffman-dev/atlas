import type { CSSProperties } from 'react';
import { groupName } from '@atlas/domain';
import type { WidgetBar } from '@atlas/application';
import { largestOf, niceTicks } from '../charts/geometry.ts';
import { useNoteNames } from '../note-names.tsx';

/**
 * Counts as upright bars, in the order the application put them — key order
 * for a series such as phases, biggest first otherwise.
 *
 * One bar is called out: cyan, lit, with its value above it and its label
 * filled. Which one is the widget's `highlight` rule; this only draws it. The
 * rest stay one muted colour, so the bars are compared by height alone.
 */
export function BarChart({
  bars,
  highlight,
}: {
  bars: readonly WidgetBar[];
  highlight: string | null;
}) {
  const names = useNoteNames();
  if (bars.length === 0) return <p className="widget__empty">Nothing to chart yet.</p>;

  const ticks = niceTicks({ max: largestOf(bars.map((bar) => bar.count)) });
  const top = ticks[ticks.length - 1] ?? 1;
  const at = (value: number): CSSProperties =>
    ({ '--at': `${(value / top) * 100}%` }) as CSSProperties;

  return (
    <div className="bars">
      <div className="bars__axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span className="bars__tick" key={tick} style={at(tick)}>
            {tick}
          </span>
        ))}
      </div>
      <div className="bars__plot">
        <div className="bars__grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span className="bars__gridline" key={tick} style={at(tick)} />
          ))}
        </div>
        <ol className="bars__columns" aria-label="Counts">
          {bars.map((bar) => (
            <li
              className={
                bar.label === highlight ? 'bars__column bars__column--current' : 'bars__column'
              }
              key={bar.label}
            >
              <span className="bars__stack">
                <span className="bars__bar" style={at(bar.count)} />
                <span className="bars__value" style={at(bar.count)}>
                  {bar.count}
                </span>
              </span>
              <span className="bars__label">{groupName(bar.label, names)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
