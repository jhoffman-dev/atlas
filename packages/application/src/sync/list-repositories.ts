import { parseRepositoryList, type GitHubRepository } from '@atlas/domain';
import { expectOk, withPrograms } from './git-steps.ts';
import type { GitHubPort } from './ports.ts';

/**
 * The person's own GitHub repositories, for Settings → Sync's picker
 * (A29-01), through the GitHub login already on this Mac. Nothing is
 * changed on GitHub: listing is the host's one read-only `gh` shape.
 */
export async function listGitHubRepositories({
  github,
}: {
  github: GitHubPort;
}): Promise<readonly GitHubRepository[]> {
  return withPrograms(async () =>
    parseRepositoryList(expectOk('list your GitHub repositories', await github.listRepositories())),
  );
}
