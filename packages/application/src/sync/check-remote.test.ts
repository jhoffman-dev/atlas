import { describe, expect, it } from 'vitest';
import { failed, said, scriptedGit, statusText } from '../testing/fake-git.ts';
import { checkRemote } from './check-remote.ts';
import { ProgramMissingError } from './ports.ts';

describe('checkRemote', () => {
  it('fetches, and says how many of the other Macs’ commits are not here yet', async () => {
    const { git, called } = scriptedGit({ script: { status: said(statusText({ behind: 3 })) } });
    await expect(checkRemote({ git })).resolves.toEqual({ behind: 3, ahead: 0 });
    expect(called('fetch')).toHaveLength(1);
  });

  it('changes nothing: no commit, no merge, no push, whatever it finds', async () => {
    const { git, called } = scriptedGit({ script: { status: said(statusText({ behind: 1 })) } });
    await checkRemote({ git });
    for (const step of ['addAll', 'commit', 'merge', 'push', 'checkout'] as const) {
      expect(called(step), step).toHaveLength(0);
    }
  });

  it('says why when GitHub cannot be reached', async () => {
    const { git } = scriptedGit({
      script: { fetch: failed('fatal: unable to access: Could not resolve host: github.com') },
    });
    await expect(checkRemote({ git })).rejects.toThrow('couldn’t be reached');
  });

  it('says how to install git when the Mac has none', async () => {
    const { git } = scriptedGit();
    await expect(
      checkRemote({
        git: {
          ...git,
          fetch: async () => {
            throw new ProgramMissingError('git');
          },
        },
      }),
    ).rejects.toThrow('xcode-select --install');
  });
});

describe('checkRemote, after the A29-01 review', () => {
  it('says how many of this Mac’s commits a sync could not push', async () => {
    const { git } = scriptedGit({ script: { status: said(statusText({ ahead: 2 })) } });
    await expect(checkRemote({ git })).resolves.toEqual({ behind: 0, ahead: 2 });
  });

  it('counts a branch not on GitHub at all as having something to send', async () => {
    const { git } = scriptedGit({ script: { status: said(statusText({ upstream: null })) } });
    await expect(checkRemote({ git })).resolves.toEqual({ behind: 0, ahead: 1 });
  });
});
