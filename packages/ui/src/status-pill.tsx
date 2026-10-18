import { optionLabel, statusTone, type StatusTone } from '@atlas/domain';

/**
 * A status as the mockups draw it: a 20px pill on its tint, with a dot and
 * its label — a table's cell, a filter, a peek's strip. The `dot` variant is
 * the bare dot alone, for a board column's head, where the label is the
 * column's own; it still names the status for a screen reader. `tone` is the
 * colour the type chose for it; without one, its name decides.
 */
export function StatusPill({
  value,
  tone,
  variant = 'pill',
}: {
  value: string;
  tone?: StatusTone;
  variant?: 'pill' | 'dot';
}) {
  // A status with no words is still a status, and an image needs a name.
  const label = optionLabel(value) || 'No status';
  const toneOf = tone ?? statusTone(value);
  if (variant === 'dot') {
    return (
      <span
        className="status-pill status-pill--dot"
        data-tone={toneOf}
        role="img"
        aria-label={label}
      >
        <span className="status-pill__dot" />
      </span>
    );
  }
  return (
    <span className="status-pill" data-tone={toneOf}>
      <span className="status-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
