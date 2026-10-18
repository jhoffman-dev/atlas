import type { CSSProperties } from 'react';
import {
  countOf,
  groupName,
  humanizeKey,
  nounOf,
  percentOf,
  type GroupCount,
  type Widget,
} from '@atlas/domain';
import type { HeroData } from '@atlas/application';
import { stackedSegments } from '../charts/geometry.ts';
import { useNoteNames } from '../note-names.tsx';
import { counted } from './counted.ts';
import { KpiItem } from './kpi-item.tsx';

/**
 * How many KPI cells a hero takes on the strip: the total, the done part when
 * the widget declares progress, and the called-out group when it has one.
 */
export function heroCells(widget: Widget, data: HeroData): number {
  return 1 + (data.part === null ? 0 : 1) + (highlightOf(widget, data) === null ? 0 : 1);
}

/** The called-out group, which needs a grouping to be named by. */
function highlightOf(widget: Widget, data: HeroData): GroupCount | null {
  return widget.groupBy === null ? null : data.highlight;
}

/**
 * The hero kind, drawn as KPI cells on the strip: the total and how many
 * groups it spans, the done part as a figure, a share and a status bar of the
 * whole, and the called-out group — the current phase — with its own count.
 * The data is the hero's as before (ADR-0010); only the drawing changed.
 */
export function HeroStrip({ widget, data }: { widget: Widget; data: HeroData }) {
  const names = useNoteNames();
  const groupNoun = widget.groupBy === null ? null : nounOf(widget.groupBy);
  const noun = widget.query?.type ?? '';
  const highlight = highlightOf(widget, data);

  return (
    <>
      <KpiItem
        label={widget.title}
        value={data.total}
        sub={
          groupNoun !== null && data.groups.length > 0
            ? countOf(data.groups.length, groupNoun)
            : undefined
        }
      />
      {data.part !== null && (
        <KpiItem
          label={humanizeKey(data.part.label)}
          value={data.part.count}
          sub={`${percentOf(data.part.count, data.total)}%`}
        >
          <StatusBar part={data.part.count} total={data.total} />
        </KpiItem>
      )}
      {groupNoun !== null && highlight !== null && (
        <KpiItem
          label={`Current ${groupNoun}`}
          value={groupName(highlight.label, names)}
          sub={counted(highlight.count, noun)}
        />
      )}
    </>
  );
}

/** The done part against the rest, as a thin bar: what the progress ring used to show. */
function StatusBar({ part, total }: { part: number; total: number }) {
  const [done, rest] = stackedSegments({ values: [part, total - part], width: 100 });
  return (
    <span className="kpi__bar" role="img" aria-label={`${percentOf(part, total)}% of all`}>
      <span className="kpi__bar-part" style={{ '--size': done?.size ?? 0 } as CSSProperties} />
      <span className="kpi__bar-rest" style={{ '--size': rest?.size ?? 0 } as CSSProperties} />
    </span>
  );
}
