import { expectOk, readStatus, withPrograms } from './git-steps.ts';
import type { GitPort } from './ports.ts';

/**
 * Asks GitHub whether other Macs pushed (A29-01): a fetch, cheap when nothing
 * changed, then how many of their commits are not here yet, and how many of
 * this Mac's have not reached GitHub — a sync that could not push leaves
 * some. It changes no file: sending and bringing in are a sync's to do.
 */
export async function checkRemote({
  git,
}: {
  git: GitPort;
}): Promise<{ behind: number; ahead: number }> {
  return withPrograms(async () => {
    expectOk('look for changes on GitHub', await git.fetch());
    const status = await readStatus(git);
    // A branch not on GitHub at all has everything still to send.
    const unsent = status.born && !status.compared ? 1 : status.ahead;
    return { behind: status.behind, ahead: unsent };
  });
}
