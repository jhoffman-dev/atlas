import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VaultAccessError } from '@atlas/application';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriVaultPicker } = await import('./tauri-vault-picker.ts');
const { tauriVaultStore } = await import('./tauri-vault-store.ts');

const location = { absolutePath: '/Users/j/Vault', name: 'Vault' };

describe('tauriVaultPicker', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('returns the folder the user chose', async () => {
    invoke.mockResolvedValue(location);
    await expect(tauriVaultPicker.pickDirectory()).resolves.toEqual(location);
    expect(invoke).toHaveBeenCalledWith('pick_vault');
  });

  it('returns null when the dialog is dismissed', async () => {
    invoke.mockResolvedValue(null);
    await expect(tauriVaultPicker.pickDirectory()).resolves.toBeNull();
  });
});

describe('tauriVaultStore', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('reads the remembered vault', async () => {
    invoke.mockResolvedValue(location);
    await expect(tauriVaultStore.read()).resolves.toEqual(location);
    expect(invoke).toHaveBeenCalledWith('current_vault');
  });

  it('returns null on a first run', async () => {
    invoke.mockResolvedValue(null);
    await expect(tauriVaultStore.read()).resolves.toBeNull();
  });

  it('hands the chosen vault to the host to open and remember', async () => {
    invoke.mockResolvedValue(undefined);
    await tauriVaultStore.write(location);
    expect(invoke).toHaveBeenCalledWith('open_vault', { location });
  });

  it('propagates a host refusal, such as a folder that has since been deleted', async () => {
    invoke.mockImplementation(() => Promise.reject(new VaultAccessError('not a folder')));
    await expect(tauriVaultStore.write(location)).rejects.toThrow('not a folder');
  });
});
