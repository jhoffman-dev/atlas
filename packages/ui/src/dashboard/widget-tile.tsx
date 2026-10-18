import { useState, type ReactNode } from 'react';
import { nounOf, withoutValue } from '@atlas/domain';
import type { WidgetResult } from '@atlas/application';
import { widgetGlyph } from '../icon.tsx';
import type { OverlaySlot } from '../overlay-slot.ts';
import { BarChart } from './bar-chart.tsx';
import { CountTable } from './count-table.tsx';
import { counted } from './counted.ts';
import { DonutChart } from './donut-chart.tsx';
import { HeroStrip, heroCells } from './hero-strip.tsx';
import { KpiItem } from './kpi-item.tsx';
import { LineChart } from './line-chart.tsx';
import { RankList } from './rank-list.tsx';
import { TableToggle } from './table-toggle.tsx';
import { WidgetFrame, type WidgetActions, type WidgetArranging } from './widget-frame.tsx';
import { WidgetGroups } from './widget-groups.tsx';
import { WidgetList, WidgetTable } from './widget-rows.tsx';

/** A widget drawn on the KPI strip rather than as a panel: a single figure, or the hero's few. */
export function onStrip({ data }: WidgetResult): boolean {
  return data.shape === 'number' || data.shape === 'hero';
}

/** Drawn as upright bars: by what is drawn, not the kind, since a SQL widget can show bars too. */
function drawnAsBars({ widget, data }: WidgetResult): boolean {
  return data.shape === 'bars' && widget.kind !== 'donut' && widget.kind !== 'line';
}

/**
 * One widget, drawn the way its kind draws: on the dashboard, and as the
 * widget editor's preview.
 */
export function WidgetTile({
  result,
  onOpenNote,
  menuSlot,
  actions,
  arranging,
}: {
  result: WidgetResult;
  onOpenNote: (path: string) => void;
  menuSlot?: OverlaySlot | undefined;
  actions?: WidgetActions | undefined;
  arranging?: WidgetArranging | undefined;
}) {
  const { widget, data } = result;
  // The widget's own, for as long as it is on the page: a remount draws the chart again (Q9).
  const [showingTable, setShowingTable] = useState(false);
  const frame = { result, menuSlot, actions, arranging };

  if (data.shape === 'hero') {
    return (
      <WidgetFrame {...frame} variant="strip" cells={heroCells(widget, data)}>
        <HeroStrip widget={widget} data={data} />
      </WidgetFrame>
    );
  }
  if (data.shape === 'number') {
    return (
      <WidgetFrame {...frame} variant="strip">
        <KpiItem
          label={widget.title}
          value={data.value}
          icon={widgetGlyph(widget.icon ?? 'hash')}
        />
      </WidgetFrame>
    );
  }
  const toggle = drawnAsBars(result) && data.shape === 'bars' && data.bars.length > 0 && (
    <TableToggle showingTable={showingTable} onToggle={() => setShowingTable((was) => !was)} />
  );
  return (
    <WidgetFrame
      {...frame}
      variant="panel"
      title={widget.title}
      aside={
        <>
          {asideOf(result)}
          {toggle}
        </>
      }
    >
      <WidgetBody result={result} showingTable={showingTable} onOpenNote={onOpenNote} />
    </WidgetFrame>
  );
}

/**
 * What a panel says right of its title: a bar chart's key to its called-out
 * group, how many it could not place and how many it counted; a donut's
 * whole; a ranking's share of the whole.
 */
function asideOf(result: WidgetResult): ReactNode {
  const { widget, data } = result;
  const noun = widget.query?.type ?? '';
  if (data.shape === 'rank') {
    // An empty ranking says so in its body; "0 of 0 tasks" would say it twice.
    if (data.rows.length === 0) return null;
    return <span className="widget__note">{`${data.shown} of ${counted(data.total, noun)}`}</span>;
  }
  if (data.shape !== 'bars') return null;
  if (widget.kind === 'donut')
    return <span className="widget__total">{counted(data.total, noun)}</span>;
  if (!drawnAsBars(result)) return null;
  return (
    <>
      {data.highlight !== null && widget.groupBy !== null && (
        <span className="bars__key">
          <span className="bars__key-swatch" aria-hidden="true" />
          Current {nounOf(widget.groupBy)}
        </span>
      )}
      {data.unset > 0 && widget.groupBy !== null && (
        <span className="widget__note">{withoutValue(data.unset, widget.groupBy)}</span>
      )}
      <span className="widget__total">{counted(data.total, noun)}</span>
    </>
  );
}

function WidgetBody({
  result: { widget, data },
  showingTable,
  onOpenNote,
}: {
  result: WidgetResult;
  showingTable: boolean;
  onOpenNote: (path: string) => void;
}) {
  const noun = widget.query?.type ?? '';
  switch (data.shape) {
    case 'error':
      return <p className="widget__error">{data.message}</p>;
    case 'rank':
      return <RankList data={data} groupBy={widget.groupBy ?? ''} noun={noun} />;
    case 'rows':
      return widget.kind === 'table' || widget.sql?.show === 'table' ? (
        <WidgetTable columns={data.columns} rows={data.rows} onOpenNote={onOpenNote} />
      ) : (
        <WidgetList columns={data.columns} rows={data.rows} onOpenNote={onOpenNote} />
      );
    case 'grouped':
      return <WidgetGroups data={data} onOpenNote={onOpenNote} />;
    case 'bars':
      if (widget.kind === 'donut')
        return <DonutChart bars={data.bars} groupBy={widget.groupBy} noun={noun} />;
      if (widget.kind === 'line') return <LineChart bars={data.bars} />;
      // With nothing to chart there is no table either: the chart says so,
      // whatever the toggle was left at.
      if (showingTable && data.bars.length > 0)
        return (
          <CountTable
            bars={data.bars}
            groupBy={widget.groupBy}
            noun={noun}
            highlight={data.highlight}
          />
        );
      return (
        <BarChart
          bars={data.bars}
          highlight={data.highlight}
          groupBy={widget.groupBy}
          noun={noun}
        />
      );
    default:
      return null;
  }
}
