import { describe, expect, it } from 'vitest';
import { CREATE_REPOSITORY_STEP, explainGitFailure, missingProgramMessage } from './git-failure.ts';

describe('explainGitFailure', () => {
  it.each([
    [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'gh auth setup-git',
    ],
    ['git@github.com: Permission denied (publickey).', 'gh auth login'],
    ['To get started with GitHub CLI, please run:  gh auth login', 'isn’t logged in'],
    ['ERROR: Repository not found.', 'can’t find that repository'],
    [
      "fatal: unable to access 'https://github.com/x/': Could not resolve host: github.com",
      'couldn’t be reached',
    ],
    ['Atlas stopped git: it ran longer than 180s.', 'took too long'],
    [
      "remote: error: File big.zip is 150.00 MB; this exceeds GitHub's file size limit of 100.00 MB\nGH001: Large files detected.",
      '100 MB size limit',
    ],
  ])('explains %j', (stderr, words) => {
    expect(explainGitFailure({ step: 'push', stderr })).toContain(words);
  });

  // "already exists" is git's own wording for a file too (e.g. a leftover
  // lock), so it is only read as a taken repository name for the step that
  // actually creates one.
  it('reads "already exists" as a taken repository name only when creating one', () => {
    const stderr = 'GraphQL: Name already exists on this account (createRepository)';
    expect(explainGitFailure({ step: CREATE_REPOSITORY_STEP, stderr })).toContain(
      'already have a repository',
    );
    expect(explainGitFailure({ step: 'push', stderr })).not.toContain('already have a repository');
  });

  // Issue #8: gh adds `origin` after making the repository; a vault that
  // already had one fails there, and "pick another name" made a second stray
  // repository on GitHub that failed the same way.
  it('reads a vault that already has an origin as that, not as a taken name', () => {
    const stderr = 'error: remote origin already exists.\n';
    const said = explainGitFailure({ step: CREATE_REPOSITORY_STEP, stderr });
    expect(said).not.toContain('already have a repository');
    expect(said).toContain('already sends to a repository');
    expect(said).toContain('Connect');
  });

  it('falls back to the last lines git printed', () => {
    expect(
      explainGitFailure({
        step: 'merge',
        stderr:
          'hint: something\nerror: Your local changes would be overwritten\nfatal: Aborting\n',
      }),
    ).toBe('Git could not merge: Your local changes would be overwritten Aborting');
  });

  it('says which step failed when git said nothing', () => {
    expect(explainGitFailure({ step: 'commit', stderr: '\n' })).toBe('Git could not commit.');
  });
});

describe('missingProgramMessage', () => {
  it('says how to install each program', () => {
    expect(missingProgramMessage('git')).toContain('xcode-select --install');
    expect(missingProgramMessage('gh')).toContain('brew install gh');
  });
});
