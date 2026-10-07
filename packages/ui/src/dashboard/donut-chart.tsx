import { legendName, pluralOf } from '@atlas/domain';
import type { WidgetBar } from '@atlas/application';
import { donutArcs } from '../charts/geometry.ts';
import { useNoteNames } from '../note-names.tsx';

const SIZE = 190;
const RADIUS = 85;
const THICKNESS = 26;
/** The white between slices, in pixels along the middle of the ring. */
const GAP = 3;

/**
 * Counts as a ring, answering "how is the whole divided".
 *
 * The biggest slice is the deep navy, the next cyan, and the rest walk down the
 * ramp. The legend is the chart for anyone who cannot see it: every slice with
 * its share and count, and the options nothing has yet listed faintly, so a
 * stage nobody is in still reads as a stage.
 */
export function DonutChart({ bars, noun }: { bars: readonly WidgetBar[]; noun: string }) {
  const names = useNoteNames();
  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  if (total === 0) return <p className="widget__empty">Nothing to chart yet.</p>;

  const arcs = donutArcs({
    values: bars.map((bar) => bar.count),
    radius: RADIUS,
    thickness: THICKNESS,
    // d3 spaces slices by padAngle × √(inner² + outer²), so this is 3px across.
    padAngle: GAP / Math.hypot(RADIUS - THICKNESS, RADIUS),
  });

  return (
    <div className="donut">
      <div className="donut__figure">
        <svg
          className="donut__ring"
          viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${total} in total`}
        >
          <circle className="donut__track" r={RADIUS - THICKNESS / 2} strokeWidth={THICKNESS} />
          {arcs.map((arc, index) =>
            arc.path === '' ? null : (
              <path
                // By position: a value genuinely called "Other" must not share a
                // key with the gathered tail.
                key={`${index}-${bars[index]?.label ?? ''}`}
                d={arc.path}
                className={`donut__slice donut__slice--${index + 1}`}
              />
            ),
          )}
        </svg>
        <div className="donut__disc">
          <span className="donut__total">{total}</span>
          <span className="donut__noun">{pluralOf(noun)}</span>
        </div>
      </div>

      <ul className="donut__legend">
        {bars.map((bar, index) => (
          <li
            className={bar.count === 0 ? 'donut__entry donut__entry--empty' : 'donut__entry'}
            key={`${index}-${bar.label}`}
          >
            <span className={`donut__swatch donut__swatch--${index + 1}`} aria-hidden="true" />
            <span className="donut__label">{legendName(bar.label, names)}</span>
            <span className="donut__share">{bar.share}%</span>
            <span className="donut__count">{bar.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
