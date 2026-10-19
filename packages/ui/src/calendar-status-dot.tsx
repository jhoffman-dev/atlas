/**
 * The status dot before an event's title on a calendar: a month's entry, a
 * note on the clock, a row in "+N more". Its colour is the `--pill-dot` the
 * entry's `data-tone` sets, so the dot says nothing of its own and the title
 * beside it is what names the note; a screen reader hears the status from the
 * note itself, never twice.
 */
export function CalendarStatusDot() {
  return <span className="calendar__dot" aria-hidden="true" />;
}
