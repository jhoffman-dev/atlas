import { describe, expect, it } from 'vitest';
import { failed, said } from '../testing/fake-git.ts';
import { listGitHubRepositories } from './list-repositories.ts';
import { ProgramMissingError, type GitResult } from './ports.ts';

const github = (answer: GitResult | (() => Promise<GitResult>)) => ({
  listRepositories: typeof answer === 'function' ? answer : async () => answer,
});

describe('listGitHubRepositories', () => {
  it('lists the repositories the Mac’s gh login can see', async () => {
    const listing = JSON.stringify([
      {
        name: 'notes',
        nameWithOwner: 'james/notes',
        defaultBranchRef: { name: 'master' },
        visibility: 'PRIVATE',
        url: 'https://github.com/james/notes',
      },
    ]);
    await expect(listGitHubRepositories({ github: github(said(listing)) })).resolves.toEqual([
      {
        name: 'notes',
        nameWithOwner: 'james/notes',
        defaultBranch: 'master',
        isPrivate: true,
        url: 'https://github.com/james/notes',
      },
    ]);
  });

  it('says to log in when gh is not logged in', async () => {
    const answer = failed('To get started with GitHub CLI, please run:  gh auth login');
    await expect(listGitHubRepositories({ github: github(answer) })).rejects.toThrow(
      'gh auth login',
    );
  });

  it('says how to install gh when the Mac has none', async () => {
    const missing = github(async () => {
      throw new ProgramMissingError('gh');
    });
    await expect(listGitHubRepositories({ github: missing })).rejects.toThrow('brew install gh');
  });

  it('refuses a listing it cannot read', async () => {
    await expect(listGitHubRepositories({ github: github(said('<html>')) })).rejects.toThrow(
      'could not be read',
    );
  });
});
