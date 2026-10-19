import type { Page } from '@playwright/test';

/** The primitives whose focus ring the ring tests (#328, #332) hold to account. */
export const RINGED_PRIMITIVES = '.btn, .field, .chip, .segmented__option';

/** What the focused primitive looks like, read in the page. */
export interface FocusedRing {
  tag: string;
  classes: string[];
  /** Its aria-label, or its text. */
  name: string;
  /** The pseudo-class its ring is drawn on. */
  ringedOn: ':focus' | ':focus-visible';
  /** Whether that pseudo-class matches, so the ring is drawn. */
  visible: boolean;
  /** Its computed box-shadow: the ring, or `none`. */
  ring: string;
}

/**
 * The primitive that has the focus and the ring it is drawn with, or null when
 * the focus is not on one. A field's ring is drawn on `:focus` (primitives.css),
 * not `:focus-visible`: WebKit hands a date input's focus to its inner segment,
 * which never matches `:focus-visible`, and the ring is there all the same.
 */
export function focusedRing(page: Page): Promise<FocusedRing | null> {
  return page.evaluate((primitives) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !focused.matches(primitives)) return null;
    const ringedOn = focused.classList.contains('field') ? ':focus' : ':focus-visible';
    return {
      tag: focused.tagName.toLowerCase(),
      classes: [...focused.classList],
      name: (focused.getAttribute('aria-label') ?? focused.textContent ?? '').trim(),
      ringedOn,
      visible: focused.matches(ringedOn),
      ring: getComputedStyle(focused).boxShadow,
    };
  }, RINGED_PRIMITIVES);
}
