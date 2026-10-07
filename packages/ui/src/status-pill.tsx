import { optionLabel, statusTone, type StatusTone } from '@atlas/domain';

/**
 * A status as the mockups draw it: a rounded pill in its ramp colour, with a
 * dot. The same pill heads a board column and fills a table's status cell.
 * `tone` is the colour the type chose for it; without one, its name decides.
 */
export function StatusPill({ value, tone }: { value: string; tone?: StatusTone }) {
  return (
    <span className="status-pill" data-tone={tone ?? statusTone(value)}>
      <span className="status-pill__dot" aria-hidden="true" />
      {optionLabel(value)}
    </span>
  );
}
