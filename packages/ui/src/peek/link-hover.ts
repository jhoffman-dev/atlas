/** How long the pointer rests on a link before its preview card shows. */
export const LINK_PREVIEW_DELAY_MS = 400;

/** Runs `run` once after `ms`; the function it returns cancels it. */
export interface HoverTimer {
  start(run: () => void, ms: number): () => void;
}

/** The browser's own timer: the one the app uses, and the one fake timers replace in tests. */
export const windowTimer: HoverTimer = {
  start(run, ms) {
    const id = globalThis.setTimeout(run, ms);
    return () => globalThis.clearTimeout(id);
  },
};

/** What the pointer and the keyboard tell the hover rule. */
export interface LinkHover<T> {
  /** The pointer is over `target`'s link: wait, then show its card. */
  enter(target: T): void;
  /** The pointer has left the link, or a key, a press or a wheel came: the card goes, as does any wait for one. */
  dismiss(): void;
}

/**
 * The link preview's delay rule (brief §5.5): a card shows once the pointer
 * has rested on one link for 400 ms, and goes as soon as it leaves or a key
 * is pressed. Entering the same link again — the pointer crossing the link's
 * own children — neither restarts the wait nor schedules another, so a
 * still or wandering pointer costs one timer per link at most, and nothing
 * at all while it is off every link.
 */
export function createLinkHover<T>({
  timer,
  delay = LINK_PREVIEW_DELAY_MS,
  onShow,
  onHide,
}: {
  timer: HoverTimer;
  delay?: number;
  onShow: (target: T) => void;
  onHide: () => void;
}): LinkHover<T> {
  let current: { target: T; shown: boolean; cancel: () => void } | null = null;

  const clear = () => {
    if (current === null) return;
    current.cancel();
    if (current.shown) onHide();
    current = null;
  };

  return {
    enter(target) {
      if (current !== null && Object.is(current.target, target)) return;
      clear();
      const entry = { target, shown: false, cancel: () => {} };
      entry.cancel = timer.start(() => {
        entry.shown = true;
        onShow(target);
      }, delay);
      current = entry;
    },
    dismiss: clear,
  };
}
