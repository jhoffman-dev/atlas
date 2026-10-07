import {
  gatherTail,
  highlightedKey,
  orderForAxis,
  rankGroups,
  sharesOf,
  sortByKey,
  splitUnset,
  withEmptyOptions,
  type GroupCount,
  type ObjectType,
  type RankedGroup,
  type Widget,
} from '@atlas/domain';

/** One group of a chart: a property value, how many notes have it, and its share of them. */
export interface WidgetBar extends GroupCount {
  /** Whole percent of every note the chart counted; a chart's shares add up to 100. */
  readonly share: number;
}

export interface BarsData {
  readonly shape: 'bars';
  /** In the order they are drawn: key order for a series, biggest first otherwise. */
  readonly bars: readonly WidgetBar[];
  /**
   * Notes with no value that are not among `bars`: a bar or line keeps them off
   * its axis, so they are counted here instead. A donut keeps them as a slice
   * of the whole, so for a donut this is 0.
   */
  readonly unset: number;
  /** Every note counted, bars and unset together. */
  readonly total: number;
  /** The label of the bar called out, or null. */
  readonly highlight: string | null;
}

export interface RankData {
  readonly shape: 'rank';
  readonly rows: readonly RankedGroup[];
  /** How many notes the shown rows hold, and how many were counted in all. */
  readonly shown: number;
  readonly total: number;
  readonly highlight: string | null;
}

/** How many slices a donut can tell apart before the rest becomes "Other". */
export const MAX_SLICES = 6;

/** Groups as a bar or line chart draws them. */
export function barsFor(widget: Widget, counted: readonly GroupCount[]): BarsData {
  const { groups, unset } = splitUnset(counted);
  const bars = widget.kind === 'line' ? sortByKey(groups) : orderForAxis(groups);
  const total = sum(counted);
  return {
    shape: 'bars',
    bars: withShares(bars, total),
    unset,
    total,
    highlight: widget.kind === 'bar' ? highlightedKey(bars, widget.highlight) : null,
  };
}

/**
 * Bars in the order they came, for a statement that ordered its own rows: its
 * ORDER BY is what it asked for, so nothing is re-sorted or set aside.
 */
export function barsInOrder(counted: readonly GroupCount[]): BarsData {
  const total = sum(counted);
  return { shape: 'bars', bars: withShares(counted, total), unset: 0, total, highlight: null };
}

/**
 * Groups as a donut draws them: biggest first, the tail gathered, and every
 * declared option of a select listed even when nothing has it yet.
 */
export function donutFor(counted: readonly GroupCount[], options: readonly string[]): BarsData {
  const slices = withEmptyOptions(gatherTail(counted, MAX_SLICES, options), options, counted);
  return {
    shape: 'bars',
    bars: withShares(slices, sum(counted)),
    unset: 0,
    total: sum(counted),
    highlight: null,
  };
}

export function rankFor(widget: Widget, counted: readonly GroupCount[]): RankData {
  const { groups } = splitUnset(counted);
  const ranked = rankGroups(groups, widget.top ?? 0);
  return {
    shape: 'rank',
    ...ranked,
    // Out of every note, not only those with a value: "96 of 177 tasks".
    total: sum(counted),
    highlight: highlightedKey(groups, widget.highlight),
  };
}

/** The declared options of the select a widget groups by, or none. */
export function optionsFor(widget: Widget, types: readonly ObjectType[]): readonly string[] {
  const type = types.find((candidate) => candidate.name === widget.query?.type);
  const property = type?.properties.find((candidate) => candidate.key === widget.groupBy);
  return property?.kind === 'select' ? property.options : [];
}

function withShares(groups: readonly GroupCount[], total: number): WidgetBar[] {
  // Shares of the whole, so a gathered or unset remainder still counts against them.
  const counts = groups.map((group) => group.count);
  const rest = total - sum(groups);
  const shares = sharesOf(rest > 0 ? [...counts, rest] : counts);
  return groups.map((group, index) => ({ ...group, share: shares[index] ?? 0 }));
}

function sum(groups: readonly GroupCount[]): number {
  return groups.reduce((total, group) => total + group.count, 0);
}
