/**
 * The person's GitHub repositories, as `gh repo list --json
 * name,nameWithOwner,defaultBranchRef,visibility,url` prints them (A29-01),
 * for Settings → Sync's picker. The host hands the JSON back untouched;
 * what it holds is read here, and anything unexpected — an entry without a
 * name, or with an address Atlas would not connect to — is left out rather
 * than guessed at.
 */

import { remoteUrlProblem } from './sync-rules.ts';

export interface GitHubRepository {
  /** `owner/name`, as GitHub shows it. */
  readonly nameWithOwner: string;
  readonly name: string;
  /** Its default branch; null for an empty repository. */
  readonly defaultBranch: string | null;
  readonly isPrivate: boolean;
  /** Its address, which connecting points `origin` at. */
  readonly url: string;
}

export class GitHubListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubListError';
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

function repositoryOf(value: unknown): GitHubRepository | null {
  if (typeof value !== 'object' || value === null) return null;
  const listed = value as Record<string, unknown>;
  const [name, nameWithOwner, url] = [
    text(listed['name']),
    text(listed['nameWithOwner']),
    text(listed['url']),
  ];
  if (name === null || nameWithOwner === null || url === null || remoteUrlProblem(url) !== null) {
    return null;
  }
  const branch = listed['defaultBranchRef'];
  const defaultBranch =
    typeof branch === 'object' && branch !== null
      ? text((branch as Record<string, unknown>)['name'])
      : null;
  return {
    name,
    nameWithOwner,
    defaultBranch,
    isPrivate: listed['visibility'] !== 'PUBLIC',
    url,
  };
}

/** The repositories the listing holds, sorted by `owner/name`. */
export function parseRepositoryList(json: string): readonly GitHubRepository[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new GitHubListError('GitHub’s list of repositories could not be read.');
  }
  if (!Array.isArray(value)) {
    throw new GitHubListError('GitHub’s list of repositories could not be read.');
  }
  return value
    .map(repositoryOf)
    .filter((repository): repository is GitHubRepository => repository !== null)
    .sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner));
}

/**
 * The repositories a search finds: every word of it in the name or the
 * owner, case and accents aside. An empty search finds them all.
 */
export function searchRepositories(
  repositories: readonly GitHubRepository[],
  query: string,
): readonly GitHubRepository[] {
  const plain = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const words = plain(query)
    .split(/\s+/)
    .filter((word) => word !== '');
  return repositories.filter((repository) =>
    words.every((word) => plain(repository.nameWithOwner).includes(word)),
  );
}
