// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import {
  fakeIndexPort,
  fakeVaultFs,
  type MarkdownPort,
  type SecretStorePort,
} from '@atlas/application';
import { useSecrets } from './use-secrets.ts';
import { SecretsSettingsCard } from './secrets-settings-card.tsx';

const TOKEN = 'ghp_HOOK_VALUE';

/** A Keychain in memory; `refuse` makes the next write fail with that message. */
function memoryStore() {
  const held = new Map<string, string>();
  const bound = new Map<string, readonly string[]>();
  const vaults: string[] = [];
  const state = { refuse: null as string | null, lists: 0 };
  const store: SecretStorePort = {
    list: async () => {
      state.lists += 1;
      return [...held.keys()].map((name) => ({ name, origins: bound.get(name) ?? [] }));
    },
    set: async ({ name, value, vault, origins }) => {
      vaults.push(vault);
      if (state.refuse !== null) throw new Error(state.refuse);
      held.set(name, value);
      if (origins !== undefined) bound.set(name, origins);
    },
    bind: async ({ name, origins, vault }) => {
      vaults.push(vault);
      bound.set(name, origins);
    },
    remove: async ({ name }) => {
      held.delete(name);
    },
  };
  return { store, held, bound, vaults, state };
}

const markdown = { frontmatterProperties: () => ({}) } as unknown as MarkdownPort;

// Built once: ports that changed on every render would re-read on every render.
const fs = fakeVaultFs();
const index = fakeIndexPort();

const renderSecrets = (store: SecretStorePort, vault: string | null = '/v', active = true) =>
  renderHook(
    ({ open }: { open: boolean }) =>
      useSecrets({ store, fs, markdown, index, vault, changeKey: 'k', active: open }),
    { initialProps: { open: active } },
  );

describe('useSecrets', () => {
  it('stores a secret bound to its sites for the open vault, and lists it by name', async () => {
    const { store, held, vaults } = memoryStore();
    const { result } = renderSecrets(store);

    let saved = false;
    await act(async () => {
      saved = await result.current.save({ name: 'github', value: TOKEN, sites: 'api.test' });
    });

    expect(saved).toBe(true);
    await waitFor(() =>
      expect(result.current.rows).toEqual([
        { name: 'github', usedBy: [], stored: true, origins: ['https://api.test'] },
      ]),
    );
    expect(held.get('github')).toBe(TOKEN);
    expect(vaults).toEqual(['/v']);
    expect(result.current.pending).toBe(false);
    expect(JSON.stringify(result.current.rows)).not.toContain(TOKEN);
  });

  it('binds a stored secret to sites', async () => {
    const { store, held, bound } = memoryStore();
    held.set('legacy', TOKEN);
    const { result } = renderSecrets(store);

    await act(async () => {
      await result.current.bind({ name: 'legacy', sites: 'a.test' });
    });

    expect(bound.get('legacy')).toEqual(['https://a.test']);
    await waitFor(() => expect(result.current.rows[0]?.origins).toEqual(['https://a.test']));
  });

  it('removes a secret', async () => {
    const { store, held } = memoryStore();
    held.set('github', TOKEN);
    const { result } = renderSecrets(store);
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => result.current.remove('github'));

    await waitFor(() => expect(result.current.rows).toEqual([]));
  });

  it('says why a write was refused, and answers that it was not saved', async () => {
    const { store, state } = memoryStore();
    state.refuse = 'the keychain refused access';
    const { result } = renderSecrets(store);

    let saved = true;
    await act(async () => {
      saved = await result.current.save({ name: 'github', value: TOKEN, sites: 'api.test' });
    });

    expect(saved).toBe(false);
    await waitFor(() => expect(result.current.problem).toBe('the keychain refused access'));
  });

  it('says why the names could not be read', async () => {
    const store: SecretStorePort = {
      ...memoryStore().store,
      list: () => Promise.reject(new Error('the keychain could not be used')),
    };
    const { result } = renderSecrets(store);

    await waitFor(() => expect(result.current.problem).toBe('the keychain could not be used'));
  });

  it('lists nothing while no vault is open', async () => {
    const { store, held } = memoryStore();
    held.set('github', TOKEN);
    const { result } = renderSecrets(store, null);

    await waitFor(() => expect(result.current.rows).toEqual([]));
  });

  it('asks the Keychain nothing until Settings is open', async () => {
    const { store, held, state } = memoryStore();
    held.set('github', TOKEN);
    const { result, rerender } = renderSecrets(store, '/v', false);

    await act(async () => undefined);
    expect(state.lists).toBe(0);
    expect(result.current.rows).toEqual([]);

    rerender({ open: true });

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(state.lists).toBe(1);
  });

  it('is drawn by the Settings card, names only', async () => {
    const { store, held } = memoryStore();
    held.set('github', TOKEN);
    const { result } = renderSecrets(store);
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    const { container } = render(<SecretsSettingsCard setting={result.current} />);

    expect(screen.getByText('github')).toBeTruthy();
    expect(container.innerHTML).not.toContain(TOKEN);
  });
});
