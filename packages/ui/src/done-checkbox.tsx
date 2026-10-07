/**
 * What a layout needs to tick notes done: whether one already is, and what to
 * do when its box changes. Given only for a type whose status has a done
 * option; without it no layout draws a box.
 */
export interface DoneTicks {
  /** Whether a note holding these values counts as finished. */
  readonly isDone: (values: Readonly<Record<string, unknown>>) => boolean;
  readonly onToggle: (args: { path: string; done: boolean }) => void;
}

/**
 * A note's done box: a real checkbox, so Space ticks it and a screen reader
 * says what it does — "Mark Write the report done".
 */
export function DoneCheckbox({
  path,
  title,
  values,
  ticks,
}: {
  path: string;
  title: string;
  values: Readonly<Record<string, unknown>>;
  ticks: DoneTicks;
}) {
  const done = ticks.isDone(values);
  return (
    <input
      type="checkbox"
      className="done-check"
      aria-label={`Mark ${title} done`}
      checked={done}
      onChange={() => ticks.onToggle({ path, done: !done })}
      // A board card is dragged from anywhere on it; a press on its box is a
      // tick, not the start of a drag.
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

/** The class a finished note's row or card carries, to be drawn struck through and dimmed. */
export function doneClass(
  base: string,
  ticks: DoneTicks | undefined,
  values: Readonly<Record<string, unknown>>,
): string {
  return ticks?.isDone(values) === true ? `${base} ${base}--done` : base;
}
