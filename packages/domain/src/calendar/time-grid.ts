/**
 * Where timed notes sit on a day's clock.
 *
 * Notes that overlap share the day's width: each takes the first lane free
 * when it starts, and every note in a run of overlaps is as narrow as that
 * run's lane count, so no note hides behind another. Positions come out in
 * minutes and lanes rather than pixels — how tall an hour is, is the view's
 * business.
 */
import { daySpan, MINUTES_PER_DAY, type CalendarEvent } from './calendar-event.ts';

/** The shortest a note is laid out as, so one of a few minutes is still something to hit. */
export const SHORTEST_BLOCK = 15;

export interface TimedBlock {
  readonly event: CalendarEvent;
  /** Minutes after midnight the block starts and ends. */
  readonly from: number;
  readonly to: number;
  /** Which lane it is in, from 0, and how many lanes its run of overlaps has. */
  readonly lane: number;
  readonly lanes: number;
}

interface Placed {
  event: CalendarEvent;
  from: number;
  to: number;
  lane: number;
}

/** A block at least `SHORTEST_BLOCK` long, kept inside the day. */
function blockOf(event: CalendarEvent, date: string): Placed | null {
  const span = daySpan(event, date);
  if (span === null) return null;
  const to = Math.min(MINUTES_PER_DAY, Math.max(span.to, span.from + SHORTEST_BLOCK));
  const from = Math.min(span.from, to - SHORTEST_BLOCK);
  return { event, from, to, lane: 0 };
}

/** Earliest first; of two starting together the longer first, so it keeps the left lane. */
function byStart(left: Placed, right: Placed): number {
  return (
    left.from - right.from ||
    right.to - left.to ||
    left.event.title.localeCompare(right.event.title) ||
    left.event.path.localeCompare(right.event.path)
  );
}

/** The timed notes on a day, each with its lane. */
export function layoutDay(events: readonly CalendarEvent[], date: string): TimedBlock[] {
  const placed = events
    .map((event) => blockOf(event, date))
    .filter((block): block is Placed => block !== null)
    .sort(byStart);

  const blocks: TimedBlock[] = [];
  let run: Placed[] = [];
  let laneEnds: number[] = [];
  let runEnd = -1;

  const closeRun = () => {
    for (const block of run) blocks.push({ ...block, lanes: laneEnds.length });
    run = [];
    laneEnds = [];
  };

  for (const block of placed) {
    // A note starting once every earlier one has ended begins a new run.
    if (block.from >= runEnd) closeRun();
    runEnd = Math.max(runEnd, block.to);
    const free = laneEnds.findIndex((end) => end <= block.from);
    block.lane = free === -1 ? laneEnds.length : free;
    laneEnds[block.lane] = block.to;
    run.push(block);
  }
  closeRun();
  return blocks;
}
