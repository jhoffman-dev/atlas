/**
 * What a screen reader hears while something is dragged.
 *
 * dnd-kit's defaults say "Draggable item first.md was moved over droppable area
 * \u0000none", which is true and useless. These are the sentences a person
 * would say instead: the note's name, and the column or date it is over. Pure,
 * so each can be read in a test without starting a drag.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-09-23` as it would be said: "Wednesday 23 September 2026". */
export function spokenDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Not `Date.UTC`: it reads the years 0 to 99 as 1900 to 1999.
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  // A date like 2026-02-31 rolls over rather than failing; say what was written.
  if (parsed.getUTCMonth() !== month - 1) return date;
  return `${WEEKDAYS[parsed.getUTCDay()] ?? ''} ${day} ${MONTHS[month - 1] ?? ''} ${year}`;
}

function spokenRange(start: string, end: string): string {
  return start === end
    ? `on ${spokenDate(start)}`
    : `from ${spokenDate(start)} to ${spokenDate(end)}`;
}

const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;

export const boardWords = {
  instructions:
    'To pick up a card, press space. Use the left and right arrow keys to move it to another column, then press space to drop it there, or escape to cancel.',
  laneInstructions:
    'To pick up a card, press space. Use the left and right arrow keys to move it to another column and the up and down arrow keys to move it to another lane, then press space to drop it there, or escape to cancel.',
  start: (card: string, column: string) => `Picked up ${card}, in ${column}.`,
  over: (card: string, column: string | null) =>
    column === null ? `${card} is not over a column.` : `${card} is over ${column}.`,
  end: (card: string, from: string, to: string | null) => {
    if (to === null) return `${card} was dropped outside the board, so it stays in ${from}.`;
    if (to === from) return `${card} was dropped back in ${from}.`;
    return `${card} moved to ${to}.`;
  },
  cancel: (card: string, from: string) => `Cancelled. ${card} stays in ${from}.`,
};

export const calendarWords = {
  instructions:
    'To pick up a note, press space. Use the left and right arrow keys to move it a day, up and down to move it a week, then press space to drop it, or escape to cancel.',
  start: (note: string, date: string) => `Picked up ${note}, on ${spokenDate(date)}.`,
  over: (note: string, date: string | null) =>
    date === null ? `${note} is not over a day.` : `${note} is over ${spokenDate(date)}.`,
  end: (note: string, from: string, to: string | null) => {
    if (to === null)
      return `${note} was dropped outside the calendar, so it stays on ${spokenDate(from)}.`;
    if (to === from) return `${note} was dropped back on ${spokenDate(from)}.`;
    return `${note} moved to ${spokenDate(to)}.`;
  },
  cancel: (note: string, date: string) => `Cancelled. ${note} stays on ${spokenDate(date)}.`,
};

export interface BarMove {
  readonly title: string;
  /** Whole days moved; negative is earlier. */
  readonly moved: number;
  /** Where the bar would land, or has landed. */
  readonly start: string;
  readonly end: string;
}

export const timelineWords = {
  instructions:
    'To pick up a bar, press space. Use the left and right arrow keys to move it a day at a time, then press space to drop it, or escape to cancel.',
  start: (bar: string, start: string, end: string) =>
    `Picked up ${bar}, ${spokenRange(start, end)}.`,
  move: ({ title, moved, start, end }: BarMove) =>
    moved === 0
      ? `${title} is back where it started.`
      : `${title} would move ${days(Math.abs(moved))} ${moved < 0 ? 'earlier' : 'later'}, ${spokenRange(start, end)}.`,
  end: ({ title, moved, start, end }: BarMove) =>
    moved === 0
      ? `${title} was dropped where it started.`
      : `${title} moved ${days(Math.abs(moved))} ${moved < 0 ? 'earlier' : 'later'}, ${spokenRange(start, end)}.`,
  cancel: (bar: string, start: string, end: string) =>
    `Cancelled. ${bar} stays ${spokenRange(start, end)}.`,
};

export const treeWords = {
  instructions:
    'To pick up a note or a folder, press space. Use the up and down arrow keys to move it over another folder, then press space to drop it there, or escape to cancel.',
  start: (entry: string) => `Picked up ${entry}.`,
  over: (entry: string, folder: string | null) =>
    folder === null ? `${entry} is not over a folder.` : `${entry} is over ${folder}.`,
  end: (entry: string, folder: string | null) =>
    folder === null
      ? `${entry} was dropped outside a folder, so it stays where it was.`
      : `${entry} moved to ${folder}.`,
  cancel: (entry: string) => `Cancelled. ${entry} stays where it was.`,
};

/** Where a held widget is: its place among the dashboard's widgets, and its width. */
export interface WidgetSpot {
  readonly title: string;
  /** 1-based, as it is said. */
  readonly position: number;
  readonly count: number;
  readonly span: number;
}

const columns = (span: number) => `${span} ${span === 1 ? 'column' : 'columns'} wide`;
const spot = ({ position, count, span }: WidgetSpot) => `${position} of ${count}, ${columns(span)}`;

export const dashboardWords = {
  instructions:
    'To pick up a widget, press space. Use the arrow keys to move it earlier or later, and shift with the left and right arrow keys to make it narrower or wider. Press space to drop it, or escape to cancel.',
  start: (at: WidgetSpot) => `Picked up ${at.title}, ${spot(at)}.`,
  move: (at: WidgetSpot) => `${at.title} is ${spot(at)}.`,
  end: (at: WidgetSpot, moved: boolean) =>
    moved ? `${at.title} dropped at ${spot(at)}.` : `${at.title} was dropped where it started.`,
  cancel: (at: WidgetSpot) => `Cancelled. ${at.title} stays ${spot(at)}.`,
};

/** Where a note held on a calendar's clock would land, or has landed. */
export interface ClockMove {
  readonly title: string;
  /** Whether it is anywhere other than where it started. */
  readonly moved: boolean;
  /** The value it would be written with, as `2026-09-22T14:30` or `2026-09-22`. */
  readonly value: string;
  /** Whether it is the note's end that moves, rather than the whole note. */
  readonly resizing: boolean;
}

/** "Tuesday 22 September 2026 at 14:30", or the day alone when there is no time. */
export function spokenMoment(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(value.trim());
  if (match === null) return value;
  const day = spokenDate(match[1] ?? '');
  return match[2] === undefined ? day : `${day} at ${match[2]}`;
}

const landing = ({ value, resizing }: ClockMove) =>
  `${resizing ? 'ending' : 'on'} ${spokenMoment(value)}`;

export const clockWords = {
  instructions:
    'To pick up a note, press space. Use the left and right arrow keys to move it a day, up and down to move it a quarter of an hour, then press space to drop it, or escape to cancel. On the handle at a note’s end, up and down make it shorter or longer.',
  start: (note: string, value: string) => `Picked up ${note}, ${spokenMoment(value)}.`,
  move: (move: ClockMove) =>
    move.moved ? `${move.title} would be ${landing(move)}.` : `${move.title} is back where it was.`,
  end: (move: ClockMove) =>
    move.moved
      ? `${move.title} is now ${landing(move)}.`
      : `${move.title} was dropped where it was.`,
  cancel: (note: string) => `Cancelled. ${note} stays where it was.`,
};

/** What a screen reader hears as a view's tab is moved along its type's tabs. */
export const tabWords = {
  start: (tab: string) => `Picked up the ${tab} tab.`,
  over: (tab: string, other: string | null) =>
    other === null ? `${tab} is not over a tab.` : `${tab} is over ${other}.`,
  end: (tab: string, other: string | null) =>
    other === null || other === tab
      ? `${tab} stays where it was.`
      : `${tab} moved to ${other}’s place.`,
  cancel: (tab: string) => `Cancelled. ${tab} stays where it was.`,
  /** After Alt+arrow: where the tab is now, counted from one. */
  moved: (tab: string, place: number, of: number) => `${tab} moved to tab ${place} of ${of}.`,
};
