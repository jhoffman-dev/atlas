import { describe, expect, it, vi } from 'vitest';
import { openVault, restoreVault } from './open-vault.ts';
import type { VaultLocation, VaultLocationStore, VaultPickerPort } from './ports.ts';

const somewhere: VaultLocation = { absolutePath: '/Users/j/Vault', name: 'Vault' };

const fakeStore = (initial: VaultLocation | null = null): VaultLocationStore => {
  let held = initial;
  return {
    read: async () => held,
    write: async (location) => {
      held = location;
    },
  };
};

describe('openVault', () => {
  it('returns the chosen vault', async () => {
    const picker: VaultPickerPort = { pickDirectory: async () => somewhere };
    await expect(openVault({ picker, store: fakeStore() })).resolves.toEqual(somewhere);
  });

  it('remembers the choice for next launch', async () => {
    const store = fakeStore();
    const picker: VaultPickerPort = { pickDirectory: async () => somewhere };
    await openVault({ picker, store });
    await expect(store.read()).resolves.toEqual(somewhere);
  });

  it('returns null when the user dismisses the picker', async () => {
    const picker: VaultPickerPort = { pickDirectory: async () => null };
    await expect(openVault({ picker, store: fakeStore() })).resolves.toBeNull();
  });

  it('does not overwrite the remembered vault when the picker is dismissed', async () => {
    const store = fakeStore(somewhere);
    const write = vi.spyOn(store, 'write');
    await openVault({ picker: { pickDirectory: async () => null }, store });
    expect(write).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toEqual(somewhere);
  });

  it('settles the vault being left before the host moves to the new one', async () => {
    const happened: string[] = [];
    const store: VaultLocationStore = {
      read: async () => null,
      write: async () => void happened.push('switched'),
    };
    await openVault({
      picker: { pickDirectory: async () => somewhere },
      store,
      beforeSwitch: async () => void happened.push('settled'),
    });
    expect(happened).toEqual(['settled', 'switched']);
  });

  it('settles nothing when the picker is dismissed, because nothing is left', async () => {
    const beforeSwitch = vi.fn(async () => {});
    await openVault({
      picker: { pickDirectory: async () => null },
      store: fakeStore(),
      beforeSwitch,
    });
    expect(beforeSwitch).not.toHaveBeenCalled();
  });

  it('propagates a picker failure', async () => {
    const picker: VaultPickerPort = { pickDirectory: () => Promise.reject(new Error('no dialog')) };
    await expect(openVault({ picker, store: fakeStore() })).rejects.toThrow('no dialog');
  });
});

describe('restoreVault', () => {
  it('returns the vault chosen last time', async () => {
    await expect(restoreVault({ store: fakeStore(somewhere) })).resolves.toEqual(somewhere);
  });

  it('returns null on a first run', async () => {
    await expect(restoreVault({ store: fakeStore() })).resolves.toBeNull();
  });
});
