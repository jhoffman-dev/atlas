import { inVault, noVaultOpen, type HostVaultFsPort, type VaultFsPort } from '@atlas/application';

/** Ports as the composition root hands them over: the host's, not yet bound to a vault. */
export type OnHost<Ports extends { fs: VaultFsPort }> = Omit<Ports, 'fs'> & {
  readonly fs: HostVaultFsPort;
};

/**
 * The same ports, writing only into `vault`: a write that finishes after another
 * vault is opened is refused by the host rather than landing in the other
 * vault's note of the same name (R14-01). With no vault open there is nothing to
 * bind to, and every write is refused (R14-04).
 */
export function boundToVault<Ports extends { fs: HostVaultFsPort }>(
  ports: Ports,
  vault: string | null,
): Omit<Ports, 'fs'> & { fs: VaultFsPort } {
  const fs = vault === null ? noVaultOpen(ports.fs) : inVault({ fs: ports.fs, vault });
  return { ...ports, fs };
}
