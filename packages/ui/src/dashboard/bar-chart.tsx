import type { CSSProperties } from 'react';
import { groupName, humanizeKey } from '@atlas/domain';
import type { WidgetBar } from '@atlas/application';
import { largestOf, niceTicks } from '../charts/geometry.ts';
import { useNoteNames } from '../note-names.tsx';
import { counted } from './counted.ts';

/**
 * Counts as upright bars, in the order the application put them — key order
 * for a series such as phases, biggest first otherwise.
 *
 * The bars are one grey and compared by height; the called-out one is the
 * pastel blue with its label in ink. Which one is the widget's `highlight`
 * rule; this only draws it. A value is written only over the first of the
 * tallest bars and the called-out one, so the picture is not a row of
 * numbers — fifty bars that tie would print fifty values over each other.
 * Every bar still names itself and its count when pointed at, and to a
 * screen reader. Not as a label on the item: a label is what `getByLabel`
 * and a rotor list by, and "Status doing · 2 tasks" would then shadow the
 * widget called "Doing".
 *
 * A SQL bar can be negative. It is drawn as no bar, at the floor, with its
 * value written there and read as it is.
 */
export function BarChart({
  bars,
  highlight,
  groupBy,
  noun,
}: {
  bars: readonly WidgetBar[];
  highlight: string | null;
  groupBy: string | null;
  noun: string;
}) {
  const names = useNoteNames();
  if (bars.length === 0) return <p className="widget__empty">Nothing to chart yet.</p>;

  const tallest = largestOf(bars.map((bar) => bar.count));
  const ticks = niceTicks({ max: tallest });
  const top = ticks[ticks.length - 1] ?? 1;
  const at = (value: number): CSSProperties =>
    ({ '--at': `${(Math.max(value, 0) / top) * 100}%` }) as CSSProperties;
  const firstTallest = bars.findIndex((bar) => bar.count === tallest);
  const nameOf = (bar: WidgetBar) => {
    const name = groupName(bar.label, names);
    return groupBy === null ? name : `${humanizeKey(groupBy)} ${name}`;
  };
  const tipOf = (bar: WidgetBar) => `${nameOf(bar)} · ${counted(bar.count, noun)}`;

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
          {bars.map((bar, index) => {
            const current = bar.label === highlight;
            return (
              <li
                className={current ? 'bars__column bars__column--current' : 'bars__column'}
                // By position: a SQL result may hand back the same label twice.
                key={`${index}-${bar.label}`}
                title={tipOf(bar)}
              >
                {/* The reading, once, for a screen reader; the drawn label and
                    value are hidden from it so a bar is not read twice. */}
                <span className="visually-hidden">{tipOf(bar)}</span>
                <span className="bars__stack">
                  <span className="bars__bar" style={at(bar.count)} />
                  {(current || index === firstTallest) && (
                    <span className="bars__value" style={at(bar.count)} aria-hidden="true">
                      {bar.count}
                    </span>
                  )}
                </span>
                <span className="bars__label" aria-hidden="true">
                  {groupName(bar.label, names)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
