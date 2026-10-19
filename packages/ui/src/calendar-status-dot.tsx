/**
 * The status dot before an event's title on a calendar: a month's entry, a
 * note on the clock, a row in "+N more". Its colour is the `--pill-dot` the
 * entry's `data-tone` sets. It is hidden from assistive technology and says
 * nothing of its own: the title beside it names the note, and the control's
 * `title` names the status ("Doing"), so the colour is never the only cue.
 */
export function CalendarStatusDot() {
  return <span className="calendar__dot" aria-hidden="true" />;
}
