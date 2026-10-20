/**
 * How long something may take before it is shown to be loading (brief §5.6).
 * The stylesheet holds the ring hidden for this long (`.spinner__ring` in
 * primitives.css, held to this number by its test).
 */
export const SPINNER_DELAY_MS = 150;

/**
 * Says something is loading — but shows it only once it has taken a while
 * (#320): the ring is held invisible for {@link SPINNER_DELAY_MS} by the
 * stylesheet's own clock, so a read that lands sooner never flashes a
 * spinner, and no skeleton stands in for what is coming. The block holds the
 * ring's place from the start, so nothing moves as it appears; `label` is
 * what a screen reader hears.
 *
 * An element, not a component: the wait costs no state, no timer and no
 * render — a page opening draws nothing more for it (the work budgets).
 */
export function delayedSpinner(label: string) {
  return (
    <p className="spinner" role="status" aria-label={label}>
      <span className="spinner__ring" aria-hidden />
    </p>
  );
}
