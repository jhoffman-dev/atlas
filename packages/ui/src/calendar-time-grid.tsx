import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { DndContext, DragOverlay, useDraggable } from '@dnd-kit/core';
import {
  clockLabel,
  dayHeading,
  dropSlot,
  eventsOn,
  isTimed,
  layoutDay,
  noteTone,
  SNAP_MINUTES,
  timeLabel,
  type CalendarEvent,
  type CalendarRange,
  type TimedBlock,
  type TrayTask,
} from '@atlas/domain';
import { AddCard } from './board-card.tsx';
import { pieceId, type CalendarGestures } from './calendar-gestures.ts';
import { clockWords, spokenDate } from './drag/announcements.ts';
import { endHandleId, HOUR_HEIGHT, MINUTE_HEIGHT, useClockDrag } from './drag/clock-drag.ts';
import { useClaimFocus, useFocusFollower, type FocusFollower } from './drag/focus.ts';
import { isTrayDrag, routedAnnouncements, useTrayDrag, type PlanTarget } from './drag/tray-drag.ts';
import { LiftedTrayTask, ScheduleTray, type Planner } from './schedule-tray.tsx';

/** The clock opens scrolled to the working day; the rest of it is a scroll away. */
const FIRST_HOUR_SHOWN = 6;
/** The hour a day's column is first reached at from the keyboard: a working day's start. */
const FIRST_SLOT_HOUR = 9;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Where a note is being added: a day, and a time unless it is all day. */
interface Adding {
  readonly date: string;
  readonly minutes: number | null;
}

/**
 * A week, three days or one day as columns: an all-day strip at the top for
 * notes whose date has no time, and under it the day's clock, where a note
 * with a time sits from when it starts to when it ends (half an hour, when it
 * does not say). Notes that overlap share the column.
 *
 * Drag a note to move it — along to another day, down to another time — or
 * its bottom edge to change when it ends, when the view reads an end. Click
 * an empty part of a day to add a note there.
 *
 * With a planner (P31-02), the next actions stand beside the clock, to be
 * dragged into its time or its blocks — or chosen, then placed with Enter or
 * a click on an hour or a block.
 */
export function CalendarTimeGrid({
  range,
  days,
  events,
  today,
  now,
  gestures,
  planner = null,
}: {
  range: CalendarRange;
  days: readonly string[];
  events: readonly CalendarEvent[];
  today: string;
  /** Minutes after midnight now, for the line across today; null to draw none. */
  now: number | null;
  gestures: CalendarGestures;
  planner?: Planner | null;
}) {
  const columns = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const dayWidth = useCallback(
    () => (columns.current?.getBoundingClientRect().width ?? 0) / Math.max(1, days.length),
    [days.length],
  );
  const drag = useClockDrag({ events, gestures, dayWidth });
  const focus = useFocusFollower();
  const plan = usePlanning({ planner, gestures, days, today, columns });
  const style = {
    gridTemplateColumns: `var(--clock-gutter) repeat(${days.length}, minmax(0, 1fr))`,
  };

  useLayoutEffect(() => {
    // A little above the hour, so its label is not cut in half at the top.
    if (scroller.current !== null) scroller.current.scrollTop = FIRST_HOUR_SHOWN * HOUR_HEIGHT - 10;
  }, [range]);

  const create = (name: string) => {
    if (adding !== null) gestures.create({ ...adding, name });
    setAdding(null);
  };

  const clock = (
    <div className={`clock clock--${range}`}>
      <div className="clock__head" style={style}>
        <span className="clock__gutter" />
        {days.map((date) => (
          <DayHeading key={date} date={date} today={today} />
        ))}
      </div>
      <div className="clock__all-day" style={style}>
        <span className="clock__gutter clock__gutter-label">All day</span>
        {days.map((date) => (
          <AllDayCell
            key={date}
            date={date}
            events={eventsOn(events, date).filter((event) => !isTimed(event))}
            gestures={gestures}
            claimFocus={focus.claim}
            adding={adding?.date === date && adding.minutes === null}
            onAdd={() => setAdding({ date, minutes: null })}
            onCreate={create}
            onClose={() => setAdding(null)}
          />
        ))}
      </div>
      <div className="clock__scroll" ref={scroller}>
        <div className="clock__body" style={{ ...style, height: 24 * HOUR_HEIGHT }}>
          <div className="clock__hours" aria-hidden="true">
            {HOURS.map((hour) => (
              <span key={hour} className="clock__hour" style={{ top: hour * HOUR_HEIGHT }}>
                {hour === 0 ? '' : clockLabel(hour * 60)}
              </span>
            ))}
          </div>
          <div className="clock__columns" ref={columns}>
            {days.map((date) => (
              <DayColumn
                key={date}
                date={date}
                blocks={layoutDay(events, date)}
                now={date === today ? now : null}
                gestures={plan.gestures}
                claimFocus={focus.claim}
                adding={adding?.date === date ? adding.minutes : null}
                placing={plan.choosing?.title ?? null}
                onAdd={(minutes) =>
                  plan.choosing === null
                    ? setAdding({ date, minutes })
                    : plan.placeAt({ kind: 'time', date, minutes })
                }
                onCreate={create}
                onClose={() => setAdding(null)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <DndContext
      sensors={drag.sensors}
      accessibility={{
        announcements: plan.announcements(drag.announcements),
        screenReaderInstructions: { draggable: clockWords.instructions },
      }}
      onDragStart={(event) => {
        if (isTrayDrag(event.active.id)) plan.tray.onDragStart(event.active.id);
        else drag.onDragStart();
      }}
      onDragMove={(event) => {
        if (isTrayDrag(event.active.id)) plan.tray.onDragMove(event);
        else drag.onDragMove(event);
      }}
      onDragEnd={(event) => {
        if (isTrayDrag(event.active.id)) {
          plan.tray.onDragEnd(event);
          return;
        }
        focus.follow(event);
        drag.onDragEnd(event);
      }}
      onDragCancel={(event) => {
        if (isTrayDrag(event.active.id)) plan.tray.onDragCancel();
        else drag.onDragCancel();
      }}
    >
      {planner === null ? (
        clock
      ) : (
        <div className="planner" onKeyDown={plan.onKeyDown}>
          {clock}
          <ScheduleTray planner={planner} choosing={plan.choosing} onChoose={plan.choose} />
          {/* The task under the pointer is drawn above the page, since the tray
              scrolls and would clip it; the announcements say where it is. */}
          <DragOverlay dropAnimation={null}>
            {plan.tray.held === null ? null : <LiftedTrayTask task={plan.tray.held} />}
          </DragOverlay>
        </div>
      )}
    </DndContext>
  );
}

/**
 * The planner's side of the clock: a task dragged from the tray, or chosen
 * there and placed with Enter or a click on an hour or a block. While one is
 * chosen, a block's button places it rather than opening the block, and an
 * hour's places it rather than adding a note; Escape lets it go.
 */
function usePlanning({
  planner,
  gestures,
  days,
  today,
  columns,
}: {
  planner: Planner | null;
  gestures: CalendarGestures;
  days: readonly string[];
  today: string;
  columns: { readonly current: HTMLDivElement | null };
}) {
  const [choosing, setChoosing] = useState<TrayTask | null>(null);
  const chosen = planner === null ? null : choosing;

  const place = useCallback(
    (task: TrayTask, target: PlanTarget) => {
      setChoosing(null);
      if (planner === null) return;
      planner.place(
        target.kind === 'time'
          ? { kind: 'time', task, date: target.date, minutes: target.minutes }
          : { kind: 'block', task, block: target.block },
      );
    },
    [planner],
  );
  const tray = useTrayDrag({ tasks: planner?.tasks ?? NO_TASKS, onPlace: place });

  const placeAt = useCallback(
    (target: PlanTarget) => {
      if (chosen === null) return;
      place(chosen, target);
      focusTrayTask(columns.current, chosen.path);
    },
    [chosen, place, columns],
  );

  const choose = useCallback(
    (task: TrayTask | null) => {
      setChoosing(task);
      if (task !== null) focusFirstHour(columns.current, days.includes(today) ? today : days[0]);
    },
    [columns, days, today],
  );

  const choosingGestures = useMemo<CalendarGestures>(
    () =>
      chosen === null
        ? gestures
        : {
            ...gestures,
            open: (path) => placeAt({ kind: 'block', block: path, title: '' }),
          },
    [chosen, gestures, placeAt],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (chosen === null || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setChoosing(null);
    focusTrayTask(columns.current, chosen.path);
  };

  return {
    choosing: chosen,
    choose,
    placeAt,
    tray,
    gestures: choosingGestures,
    onKeyDown,
    announcements: (clock: Parameters<typeof routedAnnouncements>[1]) =>
      routedAnnouncements(tray.announcements, clock),
  };
}

const NO_TASKS: readonly TrayTask[] = [];

/** Focus to a day's first hour stop, where a chosen task is placed from. */
function focusFirstHour(columns: HTMLElement | null, date: string | undefined) {
  if (date === undefined) return;
  const day = columns?.querySelector<HTMLElement>(`.clock__column[data-date="${date}"]`);
  day?.querySelector<HTMLElement>('.clock__slot[tabindex="0"]')?.focus();
}

/** Focus back to a task in the tray, beside the clock, once it is placed or let go. */
function focusTrayTask(columns: HTMLElement | null, path: string) {
  const planner = columns?.closest('.planner');
  const item = [...(planner?.querySelectorAll<HTMLElement>('.plan-tray__task') ?? [])].find(
    (element) => element.dataset['path'] === path,
  );
  item?.querySelector<HTMLElement>('button')?.focus();
}

function DayHeading({ date, today }: { date: string; today: string }) {
  const { weekday, day } = dayHeading(date);
  const isToday = date === today;
  return (
    <span className={isToday ? 'clock__day clock__day--today' : 'clock__day'}>
      <span className="clock__weekday">{weekday}</span>
      <span className="clock__date" {...(isToday && { 'aria-current': 'date' as const })}>
        {day}
      </span>
    </span>
  );
}

/** A day's all-day notes; a click on its empty space adds one. */
function AllDayCell({
  date,
  events,
  gestures,
  claimFocus,
  adding,
  onAdd,
  onCreate,
  onClose,
}: {
  date: string;
  events: readonly CalendarEvent[];
  gestures: CalendarGestures;
  claimFocus: FocusFollower['claim'];
  adding: boolean;
  onAdd: () => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="clock__all-day-cell"
      role="group"
      aria-label={`All day ${date}`}
      onClick={(event) => {
        if (gestures.canCreate && event.target === event.currentTarget) onAdd();
      }}
    >
      {gestures.canCreate && (
        <button
          type="button"
          className="clock__slot clock__slot--all-day"
          aria-label={`Add an all-day note on ${spokenDate(date)}`}
          onClick={onAdd}
        />
      )}
      {events.map((event) => (
        <ClockNote
          key={event.path}
          event={event}
          date={date}
          gestures={gestures}
          claimFocus={claimFocus}
        />
      ))}
      {adding && <AddCard label={`${date}, all day`} onAdd={onCreate} onClose={onClose} />}
    </div>
  );
}

/** The minute a click lands on in a day's column, on the quarter hour it is in. */
function minutesAt(event: MouseEvent<HTMLElement>): number {
  const top = event.currentTarget.getBoundingClientRect().top;
  return dropSlot((event.clientY - top) / MINUTE_HEIGHT);
}

function DayColumn({
  date,
  blocks,
  now,
  gestures,
  claimFocus,
  adding,
  placing,
  onAdd,
  onCreate,
  onClose,
}: {
  date: string;
  blocks: readonly TimedBlock[];
  now: number | null;
  gestures: CalendarGestures;
  claimFocus: FocusFollower['claim'];
  adding: number | null;
  /** The task being placed from the planner's tray, which an hour or a block takes. */
  placing: string | null;
  onAdd: (minutes: number) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const takesClicks = gestures.canCreate || placing !== null;
  return (
    <div
      className="clock__column"
      role="group"
      aria-label={date}
      data-date={date}
      onClick={(event) => {
        if (takesClicks && event.target === event.currentTarget) onAdd(minutesAt(event));
      }}
    >
      {takesClicks && <HourSlots date={date} placing={placing} onAdd={onAdd} />}
      {blocks.map((block) => (
        <ClockNote
          key={block.event.path}
          event={block.event}
          date={date}
          block={block}
          gestures={gestures}
          claimFocus={claimFocus}
          placing={placing}
        />
      ))}
      {now !== null && (
        <span className="clock__now" style={{ top: now * MINUTE_HEIGHT }} aria-hidden="true" />
      )}
      {adding !== null && (
        <div className="clock__adding" style={{ top: adding * MINUTE_HEIGHT }}>
          <AddCard label={`${date} at ${clockLabel(adding)}`} onAdd={onCreate} onClose={onClose} />
        </div>
      )}
    </div>
  );
}

/**
 * A day's hours as buttons, for a keyboard and a screen reader: one stop a
 * day, at 09:00; the arrows go up and down the hours, and Enter adds a note
 * at one. The pointer passes through them to the column, which adds at the
 * quarter hour it lands on.
 */
function HourSlots({
  date,
  placing,
  onAdd,
}: {
  date: string;
  placing: string | null;
  onAdd: (minutes: number) => void;
}) {
  const spoken = spokenDate(date);
  const label = (hour: number) =>
    placing === null
      ? `Add at ${clockLabel(hour * 60)} on ${spoken}`
      : `Plan ${placing} at ${clockLabel(hour * 60)} on ${spoken}`;
  const step = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next =
      event.key === 'ArrowDown'
        ? event.currentTarget.nextElementSibling
        : event.key === 'ArrowUp'
          ? event.currentTarget.previousElementSibling
          : null;
    if (!(next instanceof HTMLElement)) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <div className="clock__slots">
      {HOURS.map((hour) => (
        <button
          key={hour}
          type="button"
          className="clock__slot"
          style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
          tabIndex={hour === FIRST_SLOT_HOUR ? 0 : -1}
          aria-label={label(hour)}
          onClick={() => onAdd(hour * 60)}
          onKeyDown={step}
        />
      ))}
    </div>
  );
}

interface ClockNoteProps {
  event: CalendarEvent;
  date: string;
  block?: TimedBlock;
  gestures: CalendarGestures;
  claimFocus: FocusFollower['claim'];
  /** A task being placed from the planner's tray, which this note takes when chosen. */
  placing?: string | null;
}

/** The end handle a note's last piece carries, and how far it is pulled down (null when not held). */
interface EndGrip {
  readonly handle: ReactNode;
  readonly pulled: number | null;
}

/**
 * A note on the clock, or in the all-day strip. Picked up anywhere by the
 * pointer, or with Space on its button; Enter and a click open it. Only the
 * piece its end is on has the end handle: a note past midnight is drawn in
 * pieces, and one drag id registered by each would stretch them all.
 */
function ClockNote(props: ClockNoteProps) {
  const { block, gestures } = props;
  const showsEnd = block !== undefined && gestures.canResize && isLastPiece(block);
  return showsEnd ? <EndedClockNote {...props} /> : <ClockNoteBox {...props} end={null} />;
}

function EndedClockNote(props: ClockNoteProps) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: endHandleId(props.event),
  });
  const handle = (
    <button
      type="button"
      className="clock__end"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-label={`Change when ${props.event.title} ends`}
    />
  );
  const pulled = isDragging && transform !== null ? transform.y : null;
  return <ClockNoteBox {...props} end={{ handle, pulled }} />;
}

function ClockNoteBox({
  event,
  date,
  block,
  gestures,
  claimFocus,
  placing = null,
  end,
}: ClockNoteProps & { end: EndGrip | null }) {
  const id = pieceId(event, date);
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, isDragging } =
    useDraggable({ id });
  const buttonRef = useClaimFocus<HTMLButtonElement>({
    claim: claimFocus,
    id,
    alsoRef: setActivatorNodeRef,
  });
  const placed = useMemo(() => (block === undefined ? undefined : blockStyle(block)), [block]);
  const moved = transform === null ? undefined : `translate(${transform.x}px, ${transform.y}px)`;
  const pulled = end?.pulled ?? null;
  // A held end stretches the note under the pointer rather than moving it.
  const stretched =
    placed === undefined || pulled === null
      ? placed
      : { ...placed, height: Math.max(SNAP_MINUTES * MINUTE_HEIGHT, placed.height + pulled) };
  const classes = ['clock__note'];
  if (block === undefined) classes.push('clock__note--all-day');
  if (isDragging || pulled !== null) classes.push('clock__note--held');

  return (
    <article
      className={classes.join(' ')}
      ref={setNodeRef}
      data-path={event.path}
      data-tone={noteTone(event.values) ?? undefined}
      style={{ ...stretched, transform: moved }}
      {...listeners}
    >
      <button
        type="button"
        ref={buttonRef}
        {...attributes}
        {...(placing !== null && { 'aria-label': `Plan ${placing} in ${event.title}` })}
        onClick={() => gestures.open(event.path)}
      >
        <span className="clock__note-title">{event.title}</span>
        {block !== undefined && <span className="clock__note-time">{timeLabel(event, date)}</span>}
      </button>
      {end?.handle}
    </article>
  );
}

/** Whether this piece of a note is the one its end is on, where the handle belongs. */
function isLastPiece(block: TimedBlock): boolean {
  return block.to < 1440 || block.event.end === null;
}

function blockStyle(block: TimedBlock) {
  const width = 100 / block.lanes;
  return {
    top: block.from * MINUTE_HEIGHT,
    height: (block.to - block.from) * MINUTE_HEIGHT,
    left: `${block.lane * width}%`,
    width: `${width}%`,
  };
}
