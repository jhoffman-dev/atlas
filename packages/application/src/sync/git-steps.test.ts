import { describe, expect, it } from 'vitest';
import { NOTHING_LEFT_OUT, type LeftOut } from '@atlas/domain';
import { failed, said, scriptedGit, statusText } from '../testing/fake-git.ts';
import { commitAll, stageAll } from './git-steps.ts';

const largeOut = (path: string): LeftOut => ({ large: [path], nested: [] });

describe('stageAll', () => {
  it('stages everything when nothing is left out', async () => {
    const { git, called } = scriptedGit();
    await stageAll({ git, leftOut: NOTHING_LEFT_OUT });
    expect(called('addAll')).toHaveLength(1);
    expect(called('unstage')).toHaveLength(0);
    expect(called('untrack')).toHaveLength(0);
  });

  it('unstages a large file `add --all` staged anyway, when it is already tracked', async () => {
    const { git, called } = scriptedGit({
      script: { indexEntries: said(`100644 ${'a'.repeat(40)} 0\tBig.bin\0`) },
    });
    await stageAll({ git, leftOut: largeOut('Big.bin') });
    expect(called('unstage').map(({ args }) => args)).toEqual(['Big.bin']);
    expect(called('untrack')).toHaveLength(0);
  });

  it('stops tracking a large file when there is no earlier version to go back to', async () => {
    const { git, called } = scriptedGit({
      script: {
        indexEntries: said(`100644 ${'a'.repeat(40)} 0\tBig.bin\0`),
        unstage: failed('fatal: no such commit', 128),
      },
    });
    await stageAll({ git, leftOut: largeOut('Big.bin') });
    expect(called('untrack').map(({ args }) => args)).toEqual(['Big.bin']);
  });

  it('never asks the index about a large file that was never staged', async () => {
    // `Big.bin` is left out but was never in the index to begin with (it was
    // excluded from the very first sync onward, so `add --all` never staged
    // it): nothing to unstage or untrack.
    const { git, called } = scriptedGit({ script: { indexEntries: said('') } });
    await stageAll({ git, leftOut: largeOut('Big.bin') });
    expect(called('unstage')).toHaveLength(0);
    expect(called('untrack')).toHaveLength(0);
  });
});

describe('commitAll', () => {
  it('commits when staging leaves something staged', async () => {
    const { git, called } = scriptedGit({
      script: { status: said(statusText({ changed: ['a.md'] })) },
    });
    const committed = await commitAll({
      git,
      mac: 'Studio',
      message: 'Atlas sync from Studio',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(committed).toBe(true);
    expect(called('commit')).toHaveLength(1);
  });

  it('commits nothing, and says so, when staging leaves nothing staged and no conflict remains', async () => {
    const { git, called } = scriptedGit();
    const committed = await commitAll({
      git,
      mac: 'Studio',
      message: 'Atlas sync from Studio',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(committed).toBe(false);
    expect(called('commit')).toHaveLength(0);
  });

  it('commits even with nothing staged, when a conflict is still unresolved', async () => {
    const { git, called } = scriptedGit({
      script: { status: said(statusText({ conflicts: [{ path: 'Ideas.md', code: 'UU' }] })) },
    });
    const committed = await commitAll({
      git,
      mac: 'Studio',
      message: 'Atlas sync from Studio',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(committed).toBe(true);
    expect(called('commit')).toHaveLength(1);
  });
});
