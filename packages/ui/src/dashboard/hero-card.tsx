import { useId } from 'react';
import { countOf, nounOf, percentOf, pluralOf, type Widget } from '@atlas/domain';
import type { HeroData } from '@atlas/application';
import { areaUnder, linePath, ringDash } from '../charts/geometry.ts';

const SPARK_WIDTH = 300;
const SPARK_HEIGHT = 100;
const SPARK_TOP = 22;
const SPARK_FOOT = 92;
const RING_RADIUS = 26;

/**
 * The navy card a dashboard leads with: the total, the part of it that is
 * done as a number and a ring, and a sparkline of how it spreads across the
 * grouping, with the called-out group — the current phase — in the footer.
 *
 * The one gradient on the page is this card's ground (look-and-feel.md).
 */
export function HeroCard({ widget, data }: { widget: Widget; data: HeroData }) {
  const groupNoun = widget.groupBy === null ? null : nounOf(widget.groupBy);

  return (
    <>
      <div className="hero__top">
        <div className="hero__titles">
          <p className="hero__headline">
            <span className="hero__title">{widget.title}</span>
            <span className="hero__total">{data.total}</span>
          </p>
          {groupNoun !== null && data.groups.length > 0 && (
            <span className="hero__muted">across {countOf(data.groups.length, groupNoun)}</span>
          )}
        </div>
        {data.part !== null && <ProgressRing part={data.part.count} total={data.total} />}
      </div>

      {data.part !== null && (
        <p className="hero__part">
          <span className="hero__part-value">{data.part.count}</span>
          <span className="hero__part-label">{data.part.label}</span>
        </p>
      )}

      {data.groups.length > 1 && <Sparkline counts={data.groups.map((group) => group.count)} />}

      {groupNoun !== null && data.highlight !== null && (
        <p className="hero__foot">
          <span className="hero__foot-label">This {groupNoun}</span>
          <span className="hero__foot-value">+{data.highlight.count}</span>
          <span className="widget__spacer" />
          <span className="hero__muted">
            {pluralOf(widget.query?.type ?? '')} per {groupNoun}
          </span>
        </p>
      )}
    </>
  );
}

function ProgressRing({ part, total }: { part: number; total: number }) {
  const percent = percentOf(part, total);
  return (
    <div className="hero__ring">
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${percent}% of all`}>
        <circle className="hero__ring-track" cx="32" cy="32" r={RING_RADIUS} />
        <circle
          className="hero__ring-value"
          cx="32"
          cy="32"
          r={RING_RADIUS}
          strokeDasharray={ringDash({
            radius: RING_RADIUS,
            fraction: total > 0 ? part / total : 0,
          })}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="hero__ring-label" aria-hidden="true">
        {percent}%
      </span>
    </div>
  );
}

function Sparkline({ counts }: { counts: readonly number[] }) {
  const fill = useId();
  // The line runs between SPARK_TOP and SPARK_FOOT, not edge to edge: the
  // foot leaves room under the lowest reading and the fill runs on below it.
  const { path, points } = linePath({
    values: counts,
    width: SPARK_WIDTH,
    height: SPARK_FOOT - SPARK_TOP,
    smooth: true,
  });

  return (
    <svg
      className="hero__spark"
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="hero__spark-stop-top" />
          <stop offset="100%" className="hero__spark-stop-foot" />
        </linearGradient>
      </defs>
      <g transform={`translate(0 ${SPARK_TOP})`}>
        <path
          d={areaUnder({ points, baseline: SPARK_HEIGHT - SPARK_TOP })}
          fill={`url(#${fill})`}
        />
        <path className="hero__spark-line" d={path} />
      </g>
    </svg>
  );
}
