import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { Popover } from '@base-ui/react/popover';
import {
  daysBetween,
  dayOverflow,
  eventsOn,
  monthGrid,
  noteTone,
  WEEKDAY_LABELS,
  type CalendarDay,
  type CalendarEvent,
} from '@atlas/domain';
import { AddCard } from './board-card.tsx';
import { pieceId, pieceOf, type CalendarGestures } from './calendar-gestures.ts';
import { calendarWords } from './drag/announcements.ts';
import { dropTargetUnder, snapToDropTarget, useDragSensors } from './drag/dnd.ts';
import { useClaimFocus, useFocusFollower, type FocusFollower } from './drag/focus.ts';
import { calendarStep } from './drag/snapping.ts';

/** How many rows of notes a day holds before the last becomes "+N more". */
const DAY_ROWS = 3;

/**
 * A view drawn as a month.
 *
 * Notes are placed on the day their date property names — and on every day
 * to their end, when the view reads one. Dragging one to another day moves it
 * by that many days, keeping its time. A day with more notes than fit shows
 * "+N more", which lists the rest. Clicking a day's empty space adds a note on it.
 *
 * From the keyboard: Tab to a note, Space to pick it up, Left and Right move it a
 * day, Up and Down a week, Space drops it. A held note stops at the edge of the
 * six weeks shown rather than turning the month under it.
 */
export function CalendarMonthGrid({
  events,
  anchor,
  today,
  gestures,
}: {
  events: readonly CalendarEvent[];
  anchor: string;
  today: string;
  gestures: CalendarGestures;
}) {
  const [held, setHeld] = useState<CalendarEvent | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const byPath = useMemo(() => new Map(events.map((event) => [event.path, event])), [events]);
  const days = useMemo(() => grid?.weeks.flat().map((day) => day.date) ?? [], [grid]);
  const snap = useMemo(
    () =>
      snapToDropTarget({ next: (current, direction) => calendarStep(days, current, direction) }),
    [days],
  );
  const sensors = useDragSensors(snap);
  const announcements = useMemo(() => monthAnnouncements(byPath), [byPath]);
  const focus = useFocusFollower();

  if (grid === null) return <p className="table__empty">That month cannot be shown.</p>;

  const drop = (event: DragEndEvent) => {
    setHeld(null);
    gestures.onHold(false);
    const piece = pieceOf(String(event.active.id), byPath);
    const to = event.over === null ? null : String(event.over.id);
    // The same day is not a move: writing it again would touch the file for nothing.
    if (piece === null || to === null || to === piece.date) return;
    focus.follow(event);
    gestures.move(piece.event, { days: daysBetween(piece.date, to), minutes: 0 });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropTargetUnder}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: calendarWords.instructions },
      }}
      onDragStart={({ active }) => {
        gestures.onHold(true);
        setHeld(pieceOf(String(active.id), byPath)?.event ?? null);
      }}
      onDragEnd={drop}
      onDragCancel={() => {
        setHeld(null);
        gestures.onHold(false);
      }}
    >
      <div className="calendar__weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="calendar__grid">
        {grid.weeks.flat().map((day) => (
          <Day
            key={day.date}
            day={day}
            today={today}
            onAdd={gestures.canCreate ? () => setAdding(day.date) : undefined}
          >
            <DayEntries
              day={day.date}
              entries={eventsOn(events, day.date)}
              gestures={gestures}
              claimFocus={focus.claim}
            />
            {adding === day.date && (
              <AddCard
                label={day.date}
                onAdd={(name) => {
                  gestures.create({ date: day.date, minutes: null, name });
                  setAdding(null);
                }}
                onClose={() => setAdding(null)}
              />
            )}
          </Day>
        ))}
      </div>

      {/* A day would clip a note dragged out of it, so the note under the
          pointer is drawn above the grid. It is a picture, hidden from
          assistive technology; the announcements say where it is. */}
      <DragOverlay dropAnimation={null}>
        {held === null ? null : (
          <article className="calendar__entry calendar__entry--lifted" aria-hidden="true">
            <span className="calendar__lifted-title">{held.title}</span>
          </article>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** The notes that fit on a day, and "+N more" for the rest. */
function DayEntries({
  day,
  entries,
  gestures,
  claimFocus,
}: {
  day: string;
  entries: readonly CalendarEvent[];
  gestures: CalendarGestures;
  claimFocus: FocusFollower['claim'];
}) {
  const { shown, hidden } = dayOverflow(entries, DAY_ROWS);
  return (
    <>
      {shown.map((entry) => (
        <Entry
          key={entry.path}
          id={pieceId(entry, day)}
          entry={entry}
          onOpen={gestures.open}
          claimFocus={claimFocus}
        />
      ))}
      {hidden.length > 0 && <MoreOnDay day={day} hidden={hidden} onOpen={gestures.open} />}
    </>
  );
}

/** "+2 more", which opens a list of the day's other notes. */
function MoreOnDay({
  day,
  hidden,
  onOpen,
}: {
  day: string;
  hidden: readonly CalendarEvent[];
  onOpen: (path: string) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className="calendar__more">+{hidden.length} more</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="menu-positioner" side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className="view-popover calendar__more-list" aria-label={`More on ${day}`}>
            {hidden.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="calendar__more-item"
                data-tone={noteTone(entry.values) ?? undefined}
                onClick={() => onOpen(entry.path)}
              >
                {entry.title}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** dnd-kit hands over ids; the sentences want the note's name and the day's. */
function monthAnnouncements(byPath: ReadonlyMap<string, CalendarEvent>): Announcements {
  const note = (id: UniqueIdentifier) => pieceOf(String(id), byPath)?.event.title ?? String(id);
  const home = (id: UniqueIdentifier) => pieceOf(String(id), byPath)?.date ?? '';
  const day = (id: UniqueIdentifier | undefined) => (id === undefined ? null : String(id));
  return {
    onDragStart: ({ active }) => calendarWords.start(note(active.id), home(active.id)),
    onDragOver: ({ active, over }) => calendarWords.over(note(active.id), day(over?.id)),
    onDragEnd: ({ active, over }) =>
      calendarWords.end(note(active.id), home(active.id), day(over?.id)),
    onDragCancel: ({ active }) => calendarWords.cancel(note(active.id), home(active.id)),
  };
}

/** A day is a drop target, lit while a note is over it. A click on its empty space adds a note. */
function Day({
  day,
  today,
  onAdd,
  children,
}: {
  day: CalendarDay;
  today: string;
  onAdd: (() => void) | undefined;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day.date });
  const classes = ['calendar__day'];
  if (!day.inMonth) classes.push('calendar__day--outside');
  if (day.date === today) classes.push('calendar__day--today');
  if (isOver) classes.push('calendar__day--over');

  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      role="group"
      aria-label={day.date}
      onClick={(event) => {
        if (event.target === event.currentTarget) onAdd?.();
      }}
    >
      <span className="calendar__number">{day.dayOfMonth}</span>
      {children}
    </div>
  );
}

/**
 * A note on its day. The pointer can pick it up anywhere; the keyboard picks
 * it up from its button with Space, so Enter and a click still open the note.
 */
function Entry({
  id,
  entry,
  onOpen,
  claimFocus,
}: {
  id: string;
  entry: CalendarEvent;
  onOpen: (path: string) => void;
  claimFocus: FocusFollower['claim'];
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes } = useDraggable({ id });
  const buttonRef = useClaimFocus<HTMLButtonElement>({
    claim: claimFocus,
    id,
    alsoRef: setActivatorNodeRef,
  });

  return (
    <article
      className="calendar__entry"
      ref={setNodeRef}
      data-path={entry.path}
      data-tone={noteTone(entry.values) ?? undefined}
      {...listeners}
    >
      <button type="button" ref={buttonRef} {...attributes} onClick={() => onOpen(entry.path)}>
        {entry.title}
      </button>
    </article>
  );
}
