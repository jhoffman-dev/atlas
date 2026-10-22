/**
 * How long Kindle sync stays off after Amazon's robot check (#508). Asking
 * again while Amazon doubts the account is a robot makes it surer, so an
 * automatic sync (on launch, every few hours) holds back for a day; one the
 * person asks for is theirs to make and is not held. The scheduler that runs
 * the automatic syncs asks this; it keeps when the robot check last came.
 */
export const KINDLE_ROBOT_CHECK_BACKOFF_MS = 24 * 60 * 60 * 1000;

/** Until when automatic syncs are held, given when a robot check came; null when none has. */
export function kindleAutoSyncHeldUntil(lastRobotCheckAt: number | null): number | null {
  return lastRobotCheckAt === null ? null : lastRobotCheckAt + KINDLE_ROBOT_CHECK_BACKOFF_MS;
}

/**
 * Whether an automatic sync may run at `now` (a clock's reading). A robot
 * check dated after `now` — a clock set back — holds nothing: stopping for
 * ever on a wrong clock is worse than one extra try.
 */
export function mayAutoSyncKindle(args: {
  readonly now: number;
  readonly lastRobotCheckAt: number | null;
}): boolean {
  if (args.lastRobotCheckAt === null || args.lastRobotCheckAt > args.now) return true;
  const heldUntil = kindleAutoSyncHeldUntil(args.lastRobotCheckAt);
  return heldUntil === null || args.now >= heldUntil;
}
