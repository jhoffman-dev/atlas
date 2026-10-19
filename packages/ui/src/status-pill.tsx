import { isPillHue, optionColor, optionLabel, type OptionColor } from '@atlas/domain';
import { pillPaint } from './pill-paint.ts';

/**
 * A choice as the mockups draw it: a 20px pill on its tint, with its label —
 * a table's cell, a filter, a peek's strip. A status carries its tone's dot,
 * which means something; any other option is a plain pastel pill in its hue
 * (#413), which only helps the eye find it again. The `dot` variant is the
 * bare dot alone, for a board column's head, where the label is the column's
 * own; it still names the value for a screen reader, unless it is
 * `decorative`: then the label written beside it says it once. `tone` is the
 * colour the type chose for it; without one, its value decides (`optionColor`).
 */
export function StatusPill({
  value,
  tone,
  variant = 'pill',
  decorative = false,
}: {
  value: string;
  tone?: OptionColor;
  variant?: 'pill' | 'dot';
  /** The dot sits beside its own label, so it is hidden from assistive technology. */
  decorative?: boolean;
}) {
  // A status with no words is still a status, and an image needs a name.
  const label = optionLabel(value) || 'No status';
  const color = tone ?? optionColor(null, value);
  if (variant === 'dot') {
    return (
      <span
        className="status-pill status-pill--dot"
        {...pillPaint(color)}
        {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      >
        <span className="status-pill__dot" />
      </span>
    );
  }
  return <TintedPill text={label} color={color} />;
}

/**
 * Words already written as they read — a card's "Review", a company's name —
 * on the pill their colour gives them: a tone's dot and tint, or a hue's.
 */
export function TintedPill({ text, color }: { text: string; color: OptionColor }) {
  return (
    <span className="status-pill" {...pillPaint(color)}>
      {!isPillHue(color) && <span className="status-pill__dot" aria-hidden="true" />}
      {text}
    </span>
  );
}
