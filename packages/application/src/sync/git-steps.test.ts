import { describe, expect, it } from 'vitest';
import { NOTHING_LEFT_OUT, type LeftOut } from '@atlas/domain';
import { failed, said, scriptedGit, statusText } from '../testing/fake-git.ts';
import { commitAll, identityFor, stageAll } from './git-steps.ts';

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

describe('identityFor, attacked (#87)', () => {
  const noIdentity = () => scriptedGit({ script: { config: [said(''), said('')] } }).git;

  // What git's ident code drops from a name: `<`, `>` and line breaks
  // anywhere, and control characters, spaces and `,:;"\'` at either end.
  const keptByGit = (name: string): string =>
    name
      .replace(/[<>\n]/g, '')
      .replace(/^[\0- ,:;"\\']+/, '')
      .replace(/[\0- ,:;"\\']+$/, '');

  it.each(['Studio "Pro"', '<Den>', 'Kit’s Mac', 'Zoë’s Mac 🚀', 'Mac, Lab:'])(
    'makes a name for a Mac called %j that git records exactly as made',
    async (mac) => {
      const identity = await identityFor(noIdentity(), mac);
      expect(identity).not.toBeNull();
      expect(keptByGit(identity?.name ?? '')).toBe(identity?.name);
    },
  );

  it('never makes a name with a line break, which the host refuses and the merge with it', async () => {
    const identity = await identityFor(noIdentity(), 'Studio\nLab\r');
    expect(identity?.name).not.toMatch(/[\n\r\0]/);
  });

  it.each(['🚀', 'Zoë’s Mac', '', '---'])(
    'makes a plain, non-empty email for a Mac called %j',
    async (mac) => {
      const identity = await identityFor(noIdentity(), mac);
      expect(identity?.email).toMatch(/^atlas@[a-z0-9]+(-[a-z0-9]+)*\.local$/);
    },
  );
});

describe('identityFor, for a Mac whose name leaves nothing or far too much', () => {
  const noIdentity = () => scriptedGit({ script: { config: [said(''), said('')] } }).git;

  it.each(['', '<>', ' ,:; ', '\n\t'])('names a Mac called %j "this Mac"', async (mac) => {
    expect((await identityFor(noIdentity(), mac))?.name).toBe('Atlas on this Mac');
  });

  it('keeps a long name, of four-byte characters, inside the host’s 256 bytes', async () => {
    const identity = await identityFor(noIdentity(), `${'🚀'.repeat(300)} Mac`);
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    expect(identity?.name.startsWith('Atlas on 🚀')).toBe(true);
    expect(bytes(identity?.name ?? '')).toBeLessThanOrEqual(256);
    expect(identity?.name).not.toMatch(/�|[\uD800-\uDBFF]$/);
  });

  it('keeps a long name’s email to one plain label', async () => {
    const identity = await identityFor(noIdentity(), 'Studio '.repeat(40));
    const host = identity?.email.replace(/^atlas@|\.local$/g, '') ?? '';
    expect(host.length).toBeLessThanOrEqual(63);
    expect(host).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
