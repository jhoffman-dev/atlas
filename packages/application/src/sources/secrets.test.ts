import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultEntry } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { SecretStorePort } from './ports.ts';
import { bindSecret, deleteSecret, listSecrets, saveSecret } from './secrets.ts';

/** A keychain in memory, which records what it was asked to hold. */
function memoryStore(names: readonly string[] = [], origins: readonly string[] = []) {
  const held = new Map<string, string>(names.map((name) => [name, `value-of-${name}`]));
  const bound = new Map<string, readonly string[]>(names.map((name) => [name, origins]));
  const calls: Record<string, unknown>[] = [];
  const store: SecretStorePort = {
    list: async () => [...held.keys()].map((name) => ({ name, origins: bound.get(name) ?? [] })),
    set: async (args) => {
      calls.push({ ...args });
      held.set(args.name, args.value);
      if (args.origins !== undefined) bound.set(args.name, args.origins);
    },
    bind: async (args) => {
      calls.push({ bind: args.name, origins: args.origins, vault: args.vault });
      bound.set(args.name, args.origins);
    },
    remove: async ({ name, vault }) => {
      calls.push({ name, vault });
      held.delete(name);
    },
  };
  return { store, held, bound, calls };
}

const markdown = {
  frontmatterProperties: (frontmatter: string | null) =>
    frontmatter === null
      ? {}
      : (JSON.parse(frontmatter.replace(/^---\n|\n---\n?$/g, '')) as object),
} as unknown as MarkdownPort;

const noteWith = (properties: Record<string, unknown>): string =>
  `---\n${JSON.stringify(properties)}\n---\n\nText.\n`;

const fetched = (extra: Record<string, unknown>) =>
  noteWith({
    atlas: 'source',
    format: 'json',
    url: 'https://x.test/items',
    into: 'Items',
    type: 'item',
    ...extra,
  });

/** A vault holding these files: `.atlas` ones are listed, the rest only read by path. */
function vaultWith(files: Record<string, string>) {
  const atlas = Object.keys(files).filter((path) => path.startsWith('.atlas/'));
  return fakeVaultFs({
    listDirectory: async (folder) => {
      const children = new Map<string, VaultEntry>();
      for (const path of atlas) {
        if (!path.startsWith(`${folder}/`)) continue;
        const rest = path.slice(folder.length + 1);
        const child = `${folder}/${rest.split('/')[0] ?? ''}`;
        const kind = rest.includes('/') ? 'directory' : 'file';
        children.set(child, {
          kind,
          name: child.split('/').at(-1) ?? child,
          path: createVaultPath(child),
        } as VaultEntry);
      }
      return [...children.values()];
    },
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = files[path];
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
}

describe('saveSecret', () => {
  it('stores a value bound to the sites typed, for the vault it was typed for', async () => {
    const { store, calls } = memoryStore();

    const problem = await saveSecret({
      store,
      name: 'github',
      value: 'ghp_1',
      sites: 'api.github.com',
      vault: '/v',
    });

    expect(problem).toBeNull();
    expect(calls).toEqual([
      { name: 'github', value: 'ghp_1', origins: ['https://api.github.com'], vault: '/v' },
    ]);
  });

  it('replaces a value without touching where it is sent when no sites are given', async () => {
    const { store, calls } = memoryStore(['github'], ['https://api.github.com']);

    expect(await saveSecret({ store, name: 'github', value: 'ghp_2', vault: '/v' })).toBeNull();

    expect(calls).toEqual([{ name: 'github', value: 'ghp_2', vault: '/v' }]);
  });

  it('refuses sites that are not https sites, and asks the keychain nothing', async () => {
    const { store, calls } = memoryStore();

    const problem = await saveSecret({
      store,
      name: 'github',
      value: 'ghp_1',
      sites: 'http://api.github.com',
      vault: '/v',
    });

    expect(problem).toMatch(/https site/);
    expect(calls).toEqual([]);
  });

  it('drops the whitespace a paste brings with it, from the name and the value', async () => {
    const { store, held } = memoryStore();

    await saveSecret({ store, name: ' github ', value: 'ghp_1\n', sites: 'a.test', vault: '/v' });

    expect(held.get('github')).toBe('ghp_1');
  });

  it('refuses a name a source could not refer to, and asks the keychain nothing', async () => {
    const { store, calls } = memoryStore();
    const save = (name: string) =>
      saveSecret({ store, name, value: 'x', sites: 'a.test', vault: '/v' });

    expect(await save('git hub')).toMatch(/letters, digits/);
    expect(await save('../other')).not.toBeNull();
    expect(await save('_leading')).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it('refuses an empty value', async () => {
    const { store, calls } = memoryStore();

    expect(await saveSecret({ store, name: 'github', value: '  ', vault: '/v' })).toBe(
      'A secret needs a value.',
    );
    expect(calls).toEqual([]);
  });

  it('says why the keychain refused', async () => {
    const store: SecretStorePort = {
      ...memoryStore().store,
      set: () => Promise.reject(new Error('the keychain is locked')),
    };

    expect(await saveSecret({ store, name: 'github', value: 'x', vault: '/v' })).toBe(
      'the keychain is locked',
    );
  });
});

describe('bindSecret', () => {
  it('changes where a stored secret may be sent', async () => {
    const { store, bound, calls } = memoryStore(['legacy']);

    expect(
      await bindSecret({ store, name: 'legacy', sites: 'api.test, b.test:8443', vault: '/v' }),
    ).toBeNull();

    expect(bound.get('legacy')).toEqual(['https://api.test', 'https://b.test:8443']);
    expect(calls).toEqual([
      { bind: 'legacy', origins: ['https://api.test', 'https://b.test:8443'], vault: '/v' },
    ]);
  });

  it('refuses sites that are not https sites, and asks the host nothing', async () => {
    const { store, calls } = memoryStore(['legacy']);

    expect(
      await bindSecret({ store, name: 'legacy', sites: 'https://a.test/path', vault: '/v' }),
    ).toMatch(/https site/);
    expect(calls).toEqual([]);
  });

  it('says why the host refused, as when widening was not allowed', async () => {
    const store: SecretStorePort = {
      ...memoryStore(['github']).store,
      bind: () => Promise.reject(new Error('the secret "github" was not allowed')),
    };

    expect(await bindSecret({ store, name: 'github', sites: 'x.test', vault: '/v' })).toBe(
      'the secret "github" was not allowed',
    );
  });
});

describe('deleteSecret', () => {
  it('removes the secret, from the vault it was listed for', async () => {
    const { store, held, calls } = memoryStore(['github']);

    expect(await deleteSecret({ store, name: 'github', vault: '/v' })).toBeNull();
    expect(held.has('github')).toBe(false);
    expect(calls).toEqual([{ name: 'github', vault: '/v' }]);
  });

  it('says why it could not', async () => {
    const store: SecretStorePort = {
      ...memoryStore().store,
      remove: () => Promise.reject('denied'),
    };

    expect(await deleteSecret({ store, name: 'github', vault: '/v' })).toBe('denied');
  });
});

describe('listSecrets', () => {
  it('lists names in order with the sources that use each and where it goes, never a value', async () => {
    const { store } = memoryStore(['zeta', 'github'], ['https://api.test']);
    const fs = vaultWith({
      '.atlas/sources/Issues.md': fetched({ auth: { secret: 'github' } }),
      '.atlas/sources/Plain.md': fetched({}),
      'Feeds/Stars.md': fetched({ headers: { Authorization: 'token {{secret:github}}' } }),
    });
    const index = fakeIndexPort({
      query: async () => ({ columns: ['path'], rows: [['Feeds/Stars.md']], truncated: false }),
    });

    const listed = await listSecrets({ store, fs, markdown, index });

    expect(listed.stored).toEqual([
      {
        name: 'github',
        usedBy: ['.atlas/sources/Issues.md', 'Feeds/Stars.md'],
        origins: ['https://api.test'],
      },
      { name: 'zeta', usedBy: [], origins: ['https://api.test'] },
    ]);
    expect(JSON.stringify(listed)).not.toContain('value-of-');
  });

  it('lists a name a source uses but this machine does not hold, apart', async () => {
    const { store } = memoryStore([]);
    const fs = vaultWith({
      '.atlas/sources/Cal.md': fetched({ url: 'https://c.test/{{secret:cal}}' }),
    });

    const listed = await listSecrets({ store, fs, markdown, index: fakeIndexPort() });

    expect(listed.stored).toEqual([]);
    expect(listed.unset).toEqual([{ name: 'cal', usedBy: ['.atlas/sources/Cal.md'], origins: [] }]);
  });

  it('still lists the names while the index cannot answer', async () => {
    const { store } = memoryStore(['github']);
    const index = fakeIndexPort({ query: () => Promise.reject(new Error('not open')) });

    const listed = await listSecrets({ store, fs: vaultWith({}), markdown, index });

    expect(listed.stored).toEqual([{ name: 'github', usedBy: [], origins: [] }]);
  });
});
