import { gatedByFreshPull, type AutomationRule, type RunTrigger } from '@atlas/domain';

/**
 * Whether this Mac may act on the notes now (ADR-0035 part 4): the gates of
 * a fresh pull, asked of the notes about to be read or written — none, for a
 * write that is about no note.
 */
export type FreshPullCheck = (paths: readonly string[]) => Promise<boolean>;

/**
 * A run held for the next pull: the gates were shut as it was about to ask
 * Claude, or to write what Claude said. Nothing was written. It is not the
 * rule's failure: its news is kept, and it runs once a pull completes.
 */
export class HeldForPullError extends Error {
  constructor() {
    super('Held until this Mac has pulled since it last slept, and is still the one named.');
    this.name = 'HeldForPullError';
  }
}

/**
 * Throws {@link HeldForPullError} when the run waits on the gates
 * (`gatedByFreshPull`) and they are shut; otherwise does nothing. Asked
 * right before a gated run asks Claude, and again before each write.
 */
export async function holdUnlessFresh({
  check,
  rule,
  trigger,
  paths = [],
}: {
  check: FreshPullCheck | undefined;
  rule: Pick<AutomationRule, 'action'>;
  trigger: RunTrigger;
  paths?: readonly string[];
}): Promise<void> {
  if (check === undefined || !gatedByFreshPull({ rule, trigger })) return;
  if (!(await check(paths))) throw new HeldForPullError();
}
