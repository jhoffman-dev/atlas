import type { ReactNode } from 'react';
import { withoutValue } from '@atlas/domain';
import type { WidgetResult } from '@atlas/application';
import type { OverlaySlot } from '../overlay-slot.ts';
import { BarChart } from './bar-chart.tsx';
import { DonutChart } from './donut-chart.tsx';
import { HeroCard } from './hero-card.tsx';
import { LineChart } from './line-chart.tsx';
import { NumberTile } from './number-tile.tsx';
import { RankList } from './rank-list.tsx';
import { WidgetFrame, type WidgetActions, type WidgetArranging } from './widget-frame.tsx';
import { WidgetGroups } from './widget-groups.tsx';
import { WidgetList, WidgetTable } from './widget-rows.tsx';

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
  const frame = { result, menuSlot, actions, arranging };

  if (data.shape === 'hero') {
    return (
      <WidgetFrame {...frame} variant="hero">
        <HeroCard widget={widget} data={data} />
      </WidgetFrame>
    );
  }
  if (data.shape === 'number') {
    return (
      <WidgetFrame {...frame} variant="tile">
        <NumberTile widget={widget} value={data.value} />
      </WidgetFrame>
    );
  }
  return (
    <WidgetFrame {...frame} variant="card" title={widget.title} aside={asideOf(result)}>
      <WidgetBody result={result} onOpenNote={onOpenNote} />
    </WidgetFrame>
  );
}

/** What a card says right of its title: how many it counted, and how many it could not place. */
function asideOf({ widget, data }: WidgetResult): ReactNode {
  if (data.shape === 'rank') {
    return (
      <span className="widget__note">
        {data.shown} of {data.total}
      </span>
    );
  }
  if (data.shape !== 'bars' || widget.kind !== 'bar') return null;
  return (
    <>
      {data.unset > 0 && widget.groupBy !== null && (
        <span className="widget__note">{withoutValue(data.unset, widget.groupBy)}</span>
      )}
      <span className="widget__total">{data.total}</span>
    </>
  );
}

function WidgetBody({
  result: { widget, data },
  onOpenNote,
}: {
  result: WidgetResult;
  onOpenNote: (path: string) => void;
}) {
  switch (data.shape) {
    case 'error':
      return <p className="widget__error">{data.message}</p>;
    case 'rank':
      return (
        <RankList data={data} groupBy={widget.groupBy ?? ''} noun={widget.query?.type ?? ''} />
      );
    case 'rows':
      return widget.kind === 'table' || widget.sql?.show === 'table' ? (
        <WidgetTable columns={data.columns} rows={data.rows} onOpenNote={onOpenNote} />
      ) : (
        <WidgetList rows={data.rows} onOpenNote={onOpenNote} />
      );
    case 'grouped':
      return <WidgetGroups data={data} onOpenNote={onOpenNote} />;
    case 'bars':
      if (widget.kind === 'donut')
        return <DonutChart bars={data.bars} noun={widget.query?.type ?? ''} />;
      if (widget.kind === 'line') return <LineChart bars={data.bars} />;
      return <BarChart bars={data.bars} highlight={data.highlight} />;
    default:
      return null;
  }
}
