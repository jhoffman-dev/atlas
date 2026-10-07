import { describe, expect, it } from 'vitest';
import {
  automationsHandover,
  automationsMacOf,
  cloneFolderRefusal,
  emptyRepositoryRefusal,
  existingOriginRefusal,
  hasBranches,
  defaultBranchOf,
  enclosingRepositoryRefusal,
  isOwnRepository,
  isRepositoryName,
  isSetUpByAtlas,
  macOfCommit,
  parentFolderOf,
  syncSetUpMessage,
  remoteUrlProblem,
  repositoryNameOf,
  runsAutomationsHere,
  suggestedRepositoryName,
  SYNC_KEY,
  SYNC_KEY_VALUE,
  syncCommitMessage,
} from './sync-rules.ts';
import {
  GITIGNORE_PATH,
  hasManagedIgnores,
  MANAGED_IGNORES,
  withManagedIgnores,
} from './sync-ignore.ts';

describe('the automations Mac', () => {
  // A29-01: by the id each Mac keeps for itself, not by its name, which a
  // rename changes and two Macs can share.
  it('runs automations only on the Mac the settings name, by its id', () => {
    expect(runsAutomationsHere({ automationsMac: 'mac-1', thisMacId: 'mac-1' })).toBe(true);
    expect(runsAutomationsHere({ automationsMac: 'mac-1', thisMacId: 'mac-2' })).toBe(false);
    expect(runsAutomationsHere({ automationsMac: 'Studio', thisMacId: 'mac-1' })).toBe(false);
  });

  it('runs them anywhere when no Mac is named, as before sync', () => {
    expect(runsAutomationsHere({ automationsMac: null, thisMacId: 'mac-2' })).toBe(true);
  });

  it('reads the setting, ignoring blanks and other kinds', () => {
    expect(automationsMacOf(' Studio ')).toBe('Studio');
    expect(automationsMacOf('')).toBeNull();
    expect(automationsMacOf(3)).toBeNull();
    expect(automationsMacOf(undefined)).toBeNull();
  });
});

describe('syncCommitMessage', () => {
  it('names the Mac and its wall-clock minute', () => {
    expect(syncCommitMessage({ mac: 'Laptop', localNow: '2026-09-28T14:05:59' })).toBe(
      'Atlas sync from Laptop 2026-09-28 14:05',
    );
    expect(syncCommitMessage({ mac: ' ', localNow: '2026-09-28T14:05:59' })).toBe(
      'Atlas sync from a Mac 2026-09-28 14:05',
    );
  });
});

describe('macOfCommit', () => {
  it('reads the Mac back out of what Atlas called its commits', () => {
    const synced = syncCommitMessage({
      mac: 'James’s MacBook Pro',
      localNow: '2026-09-28T14:05:00',
    });
    expect(macOfCommit(synced)).toBe('James’s MacBook Pro');
    expect(macOfCommit(`${syncSetUpMessage('Studio')}\n`)).toBe('Studio');
  });

  it('knows no Mac for a commit Atlas did not make', () => {
    expect(macOfCommit('Fix typo')).toBeNull();
    expect(macOfCommit('Atlas sync from  2026-09-28 14:05')).toBeNull();
    expect(macOfCommit('')).toBeNull();
  });
});

describe('remoteUrlProblem', () => {
  it.each([
    'https://github.com/james/notes.git',
    'https://github.com/james/notes',
    'git@github.com:james/notes.git',
    'ssh://git@github.com/james/notes.git',
    '/Volumes/Backup/notes.git',
  ])('accepts %s', (url) => expect(remoteUrlProblem(url)).toBeNull());

  it.each([
    '',
    '   ',
    '-u evil',
    'ext::sh -c touch% /tmp/pwned',
    'https://github.com/a b',
    'http://github.com/james/notes',
    'notes',
    'git@github.com:-oProxyCommand=x',
    `https://${'a'.repeat(2050)}`,
  ])('refuses %j', (url) => expect(remoteUrlProblem(url)).not.toBeNull());

  it('refuses any user at all in an https address, password or none', () => {
    expect(remoteUrlProblem('https://james@github.com/james/notes.git')).not.toBeNull();
    expect(remoteUrlProblem('https://james:hunter2@github.com/james/notes.git')).not.toBeNull();
  });

  it('refuses a password in an ssh:// address', () => {
    expect(remoteUrlProblem('ssh://git:hunter2@github.com/james/notes.git')).not.toBeNull();
  });

  it('accepts an ssh:// address with just a user name, no password', () => {
    expect(remoteUrlProblem('ssh://git@github.com/james/notes.git')).toBeNull();
  });

  it('accepts the scp-like form with just a user name', () => {
    expect(remoteUrlProblem('git@github.com:james/notes.git')).toBeNull();
  });
});

describe('defaultBranchOf', () => {
  it('reads the branch a remote’s HEAD points at', () => {
    expect(defaultBranchOf('ref: refs/heads/main\tHEAD\n')).toBe('main');
    expect(defaultBranchOf('ref: refs/heads/release/2026\tHEAD')).toBe('release/2026');
  });

  it('reads no branch for an empty repository', () => {
    expect(defaultBranchOf('')).toBeNull();
  });
});

describe('isSetUpByAtlas', () => {
  const gitignore = withManagedIgnores(null);

  it('is true only when the settings say github and the gitignore holds Atlas’s block', () => {
    expect(isSetUpByAtlas({ settings: { [SYNC_KEY]: SYNC_KEY_VALUE }, gitignore })).toBe(true);
  });

  it('is false when the setting is missing or says something else', () => {
    expect(isSetUpByAtlas({ settings: {}, gitignore })).toBe(false);
    expect(isSetUpByAtlas({ settings: { [SYNC_KEY]: 'obsidian-git' }, gitignore })).toBe(false);
  });

  it('is false when there is no gitignore, or it lacks Atlas’s block', () => {
    expect(isSetUpByAtlas({ settings: { [SYNC_KEY]: SYNC_KEY_VALUE }, gitignore: null })).toBe(
      false,
    );
    expect(
      isSetUpByAtlas({ settings: { [SYNC_KEY]: SYNC_KEY_VALUE }, gitignore: 'node_modules/' }),
    ).toBe(false);
  });
});

describe('hasManagedIgnores', () => {
  it('is true only when the block is whole, opening and closing line both present', () => {
    expect(hasManagedIgnores(withManagedIgnores(null))).toBe(true);
    expect(hasManagedIgnores('node_modules/')).toBe(false);
  });

  it('is false when the block’s closing line is missing', () => {
    const opened = withManagedIgnores(null).split('\n').slice(0, 2).join('\n');
    expect(hasManagedIgnores(opened)).toBe(false);
  });
});

describe('repository names', () => {
  it('takes a clone’s folder from the address', () => {
    expect(repositoryNameOf('https://github.com/james/My-Notes.git')).toBe('My-Notes');
    expect(repositoryNameOf('git@github.com:james/notes.git/')).toBe('notes');
    expect(repositoryNameOf('https://github.com/james/.hidden')).toBe('vault');
    expect(repositoryNameOf('')).toBe('vault');
  });

  it('suggests a GitHub name from the vault’s folder', () => {
    expect(suggestedRepositoryName('James’s Notes')).toBe('James-s-Notes');
    expect(suggestedRepositoryName('...')).toBe('atlas-vault');
    expect(isRepositoryName(suggestedRepositoryName('James’s Notes'))).toBe(true);
  });

  it('accepts only names gh is handed', () => {
    expect(isRepositoryName('notes.v2_x-y')).toBe(true);
    expect(isRepositoryName('-notes')).toBe(false);
    expect(isRepositoryName('.notes')).toBe(false);
    expect(isRepositoryName('a/b')).toBe(false);
    expect(isRepositoryName('')).toBe(false);
  });
});

describe('a vault inside another repository', () => {
  it('is refused, naming the repository it is in', () => {
    const refusal = enclosingRepositoryRefusal({
      topFromVault: '/Users/j/Projects/atlas',
      topFromParent: '/Users/j/Projects/atlas/',
    });
    expect(refusal).toContain('inside another git repository (atlas)');
  });

  it('is refused even when the vault is a repository of its own', () => {
    const nested = {
      topFromVault: '/Users/j/Projects/atlas/vault',
      topFromParent: '/Users/j/Projects/atlas',
    };
    expect(enclosingRepositoryRefusal(nested)).not.toBeNull();
    expect(isOwnRepository(nested)).toBe(false);
  });

  it('is allowed when it is its own repository, or in none', () => {
    // git answers with symlinks resolved; the vault's own path is never compared.
    const own = { topFromVault: '/private/tmp/notes', topFromParent: null };
    expect(enclosingRepositoryRefusal(own)).toBeNull();
    expect(isOwnRepository(own)).toBe(true);
    const bare = { topFromVault: null, topFromParent: null };
    expect(enclosingRepositoryRefusal(bare)).toBeNull();
    expect(isOwnRepository(bare)).toBe(false);
  });

  it('finds the folder above a vault', () => {
    expect(parentFolderOf('/Users/j/Notes/')).toBe('/Users/j');
    expect(parentFolderOf('/Notes')).toBe('/');
  });
});

describe('withManagedIgnores', () => {
  it('writes the block into a vault with no .gitignore', () => {
    const text = withManagedIgnores(null);
    for (const { pattern } of MANAGED_IGNORES) expect(text).toContain(`\n${pattern}\n`);
    expect(text).toContain('.atlas-cache/');
    expect(GITIGNORE_PATH).toBe('.gitignore');
  });

  it('never leaves out anything that should sync', () => {
    const patterns = MANAGED_IGNORES.map(({ pattern }) => pattern);
    for (const synced of ['.atlas/', '.atlas', 'Chats/', '*.md', 'Attachments/']) {
      expect(patterns).not.toContain(synced);
    }
  });

  it('adds the block after the person’s own lines, and replaces it rather than adding a second', () => {
    const once = withManagedIgnores('*.tmp');
    expect(once.startsWith('*.tmp\n\n# >>> Atlas sync')).toBe(true);
    const again = withManagedIgnores(once);
    expect(again).toBe(once);
    const edited = once.replace('.DS_Store', 'something.else');
    expect(withManagedIgnores(edited)).toBe(once);
  });

  it('leaves one blank line after a file that already ends in a newline', () => {
    expect(withManagedIgnores('*.tmp\n').startsWith('*.tmp\n\n# >>> Atlas sync')).toBe(true);
  });
});

// Issue #8: a vault from GitHub copied into the open vault became a folder
// inside it, and opening it left the vault the person had behind.
describe('where a vault from GitHub may be copied', () => {
  const openVault = '/Users/j/Atlas Vault';

  it('refuses the open vault itself, and says where setting up sync is', () => {
    const refusal = cloneFolderRefusal({ picked: '/Users/j/Atlas Vault/', openVault });
    expect(refusal).toContain('Atlas Vault is the vault you have open');
    expect(refusal).toContain('Settings → Sync');
  });

  it('refuses a folder inside the open vault, however it is spelled', () => {
    expect(cloneFolderRefusal({ picked: '/Users/j/Atlas Vault/Chats', openVault })).not.toBeNull();
    expect(cloneFolderRefusal({ picked: '/users/J/atlas vault/chats', openVault })).not.toBeNull();
    expect(
      cloneFolderRefusal({ picked: '/Users/j/Atlas Vault', openVault: '/Users/j/Atlas Vault/' }),
    ).not.toBeNull();
  });

  it('allows the folder above the vault, one beside it, and any folder with no vault open', () => {
    expect(cloneFolderRefusal({ picked: '/Users/j', openVault })).toBeNull();
    expect(cloneFolderRefusal({ picked: '/Users/j/Atlas Vault 2', openVault })).toBeNull();
    expect(cloneFolderRefusal({ picked: '/Users/j/Atlas Vault', openVault: null })).toBeNull();
  });
});

// Issue #8: `gh repo create --remote=origin` cannot add an origin the vault
// already has, so a new repository was made on GitHub and then left behind.
describe('a new repository for a vault that already sends somewhere', () => {
  it('names where it sends now, and the two ways on', () => {
    const refusal = existingOriginRefusal('git@github.com:j/obsidian-backup.git');
    expect(refusal).toContain('This vault already sends to git@github.com:j/obsidian-backup.git');
    expect(refusal).toContain('Connect existing repo');
    expect(refusal).toContain('git remote remove origin');
  });
});

// Issue #8: an empty repository holds no vault to open; the person meant to
// put the open vault in it.
describe('a repository with nothing in it', () => {
  it('has no branches when ls-remote lists none', () => {
    expect(hasBranches('')).toBe(false);
    expect(hasBranches('\n')).toBe(false);
    expect(hasBranches('39e8579c0ffee\trefs/heads/main\n')).toBe(true);
  });

  it('is refused with where to put this vault in it instead', () => {
    expect(emptyRepositoryRefusal()).toContain('This repository is empty');
    expect(emptyRepositoryRefusal()).toContain('Settings → Sync');
  });
});

// Issue #8: a first connect keeps this vault's settings note and copies the
// other side's to Sync conflicts/, which held the automations Mac.
describe('who the automations go to when sync is set up', () => {
  const mac = { id: 'mac-air', name: 'Air' };

  it('goes to this Mac when no side names one', () => {
    expect(automationsHandover({ ours: {}, theirs: null, mac })).toEqual({
      automationsMac: 'mac-air',
      automationsMacName: 'Air',
    });
    expect(automationsHandover({ ours: {}, theirs: { quickAdd: ['task'] }, mac })).toEqual({
      automationsMac: 'mac-air',
      automationsMacName: 'Air',
    });
  });

  it('changes nothing when this vault’s settings name a Mac already', () => {
    expect(
      automationsHandover({
        ours: { automationsMac: 'mac-laptop' },
        theirs: { automationsMac: 'mac-studio' },
        mac,
      }),
    ).toEqual({});
  });

  it('keeps them with the Mac the other side names, carried into this vault’s settings', () => {
    expect(
      automationsHandover({
        ours: {},
        theirs: { automationsMac: ' mac-studio ', automationsMacName: 'Studio' },
        mac,
      }),
    ).toEqual({ automationsMac: 'mac-studio', automationsMacName: 'Studio' });
    expect(
      automationsHandover({ ours: {}, theirs: { automationsMac: 'mac-studio' }, mac }),
    ).toEqual({ automationsMac: 'mac-studio' });
  });
});
