import { invoke } from '@tauri-apps/api/core';
import type { VaultLocation, VaultPickerPort } from '@dfai/application';
import { throughHost } from './host-error.ts';

export const tauriVaultPicker: VaultPickerPort = {
  pickDirectory() {
    return throughHost(invoke<VaultLocation | null>('pick_vault'));
  },
};
