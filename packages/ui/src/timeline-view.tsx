import { useMemo } from 'react';
import { DndContext, useDraggable } from '@dnd-kit/core';
import {
  buildTimeline,
  criticalPathIds,
  dependencyGraph,
  timelineEntryId,
  addDays,
  daysBetween,
  formatPropertyDate,
  noteTone,
  type BoardRow,
  type TimelineEntry,
} from '@atlas/domain';
import { timelineWords } from './drag/announcements.ts';
import { alongItsRow, useBarDrag } from './drag/bar-drag.ts';

/** Enough width per day that a one-day bar is still something you can hit. */
const DAY_WIDTH = 26;

/**
 * The same query as a Gantt chart.
 *
 * Bars are placed in days by the domain and turned into pixels here, which keeps
 * the arithmetic that decides a plan out of the component that draws it. The
 * chain that decides the end date is picked out, because that is the one a plan
 * is read for.
 */
export function TimelineView({
  rows,
  startKey,
  endKey,
  today,
  onOpenNote,
  onReschedule,
}: {
  rows: readonly BoardRow[];
  startKey: string;
  endKey: string;
  /** Today, as `2026-09-20`. Passed in so the chart can be tested on any day. */
  today: string;
  onOpenNote: (path: string) => void;
  onReschedule: (args: { path: string; start: string; end: string }) => void;
}) {
  const timeline = useMemo(
    () => buildTimeline({ rows, startKey, endKey }),
    [rows, startKey, endKey],
  );
  const graph = useMemo(() => dependencyGraph(timeline.entries), [timeline.entries]);
  const critical = useMemo(
    () => criticalPathIds(timeline.entries, graph),
    [timeline.entries, graph],
  );

  const drag = useBarDrag({ entries: timeline.entries, dayWidth: DAY_WIDTH, onReschedule });

  if (timeline.entries.length === 0) {
    return (
      <p className="table__empty">
        Nothing on this timeline yet. Notes need a <code>{startKey}</code> date to appear.
      </p>
    );
  }

  const width = timeline.days * DAY_WIDTH;
  const todayOffset = daysBetween(timeline.start, today);
  const showToday = todayOffset >= 0 && todayOffset < timeline.days;

  return (
    <div className="timeline" aria-label="Timeline">
      <div className="timeline__meta">
        <span className="timeline__range">
          {formatPropertyDate(timeline.start) ?? timeline.start} →{' '}
          {formatPropertyDate(timeline.end) ?? timeline.end}
        </span>
        {graph.circular && (
          <span className="timeline__warning">
            These tasks block each other in a loop, so there is no critical path.
          </span>
        )}
        {graph.unknown.length > 0 && (
          <span className="timeline__warning">
            Blocked by nothing here: {graph.unknown.join(', ')}
          </span>
        )}
        {graph.duplicated.length > 0 && (
          <span className="timeline__warning">
            More than one note claims: {graph.duplicated.join(', ')}
          </span>
        )}
        {timeline.undated > 0 && (
          <span className="timeline__undated">
            {timeline.undated} with no {startKey}
          </span>
        )}
      </div>

      <div className="timeline__scroll">
        <div className="timeline__chart" style={{ width: `${width}px` }}>
          <Ruler start={timeline.start} days={timeline.days} />

          {showToday && (
            <div
              className="timeline__today"
              style={{ left: `${todayOffset * DAY_WIDTH}px` }}
              aria-label="Today"
            />
          )}

          <DndContext
            sensors={drag.sensors}
            modifiers={[alongItsRow]}
            accessibility={{
              announcements: drag.announcements,
              screenReaderInstructions: { draggable: timelineWords.instructions },
            }}
            onDragStart={drag.onDragStart}
            onDragMove={drag.onDragMove}
            onDragEnd={drag.onDragEnd}
          >
            {timeline.entries.map((entry) => (
              <Bar
                key={entry.path}
                entry={entry}
                critical={critical.has(timelineEntryId(entry))}
                onOpenNote={onOpenNote}
              />
            ))}
          </DndContext>
        </div>
      </div>
    </div>
  );
}

function Ruler({ start, days }: { start: string; days: number }) {
  return (
    <div className="timeline__ruler" aria-hidden="true">
      {Array.from({ length: days }, (_unused, day) => {
        const date = addDays(start, day);
        // Never null: the ruler runs from the first to the last day a bar is on.
        if (date === null) return null;
        return (
          <span className="timeline__day" key={date} style={{ width: `${DAY_WIDTH}px` }}>
            {date.slice(8)}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A bar, dragged along its row by a pointer or, after Space, by the arrow keys.
 * A press that travels less than a few pixels is a click and opens the note, as
 * does Enter.
 */
function Bar({
  entry,
  critical,
  onOpenNote,
}: {
  entry: TimelineEntry;
  critical: boolean;
  onOpenNote: (path: string) => void;
}) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: entry.path,
  });
  const classes = [
    'timeline__bar',
    entry.milestone ? 'timeline__bar--milestone' : '',
    critical ? 'timeline__bar--critical' : '',
    isDragging ? 'timeline__bar--held' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');

  return (
    <div className="timeline__row">
      <button
        type="button"
        className={classes}
        data-path={entry.path}
        data-tone={noteTone(entry.values) ?? undefined}
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        style={{
          marginLeft: `${entry.offset * DAY_WIDTH}px`,
          width: `${entry.span * DAY_WIDTH}px`,
          transform: transform === null ? undefined : `translate3d(${transform.x}px, 0, 0)`,
        }}
        title={`${entry.start} → ${entry.end}`}
        onClick={() => onOpenNote(entry.path)}
      >
        <span className="timeline__label">{entry.title}</span>
      </button>
    </div>
  );
}
