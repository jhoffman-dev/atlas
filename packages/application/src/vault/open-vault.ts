import type { VaultLocation, VaultLocationStore, VaultPickerPort } from './ports.ts';

/**
 * Asks the user for a vault and remembers the answer.
 * Returns null when the picker is dismissed, which is a normal outcome, not a failure.
 *
 * `beforeSwitch` runs once a vault is chosen and before the host moves to it:
 * work still unsaved in the vault being left is written while its paths still
 * mean that vault (R14-01). A dismissed picker switches nothing, so it waits.
 */
export async function openVault({
  picker,
  store,
  beforeSwitch,
}: {
  picker: VaultPickerPort;
  store: VaultLocationStore;
  beforeSwitch?: () => Promise<void>;
}): Promise<VaultLocation | null> {
  const location = await picker.pickDirectory();
  if (location === null) return null;
  await beforeSwitch?.();
  await store.write(location);
  return location;
}

/** The vault chosen last time, if there was one. */
export async function restoreVault({
  store,
}: {
  store: VaultLocationStore;
}): Promise<VaultLocation | null> {
  return store.read();
}
