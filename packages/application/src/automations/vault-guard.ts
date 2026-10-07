import type { VaultFsPort } from '../vault/ports.ts';

/**
 * Which vault an automation belongs to, and which is open now (P25-02). A rule
 * is read from one vault; if another is opened while it runs, it stops.
 */
export interface VaultGuard {
  /** The root of the vault the rule was read from. */
  readonly vault: string;
  /** The root of the vault open now, or null when none is. */
  readonly currentVault: () => string | null;
}

export class VaultChangedError extends Error {
  constructor() {
    super('Another vault was opened, so the automation stopped.');
    this.name = 'VaultChangedError';
  }
}

/** Throws unless the rule's own vault is still the one open. */
export function stillInVault(guard: VaultGuard): void {
  if (guard.currentVault() !== guard.vault) throw new VaultChangedError();
}

const WRITES = [
  'createNote',
  'createFolder',
  'moveEntry',
  'trashEntry',
  'writeTextFile',
  'writeBinaryFile',
] as const;

/**
 * The vault's files as a run may use them: every write checks first that the
 * rule's vault is still the one open, so a run cut off by a switch writes
 * nothing more — not even into the vault it belongs to, whose panes and index
 * are no longer on screen to follow it. The host refuses a write meant for
 * another vault as well; this stops the run before it gets that far.
 */
export function guardedFs(fs: VaultFsPort, guard: VaultGuard): VaultFsPort {
  const guarded: Partial<VaultFsPort> = {};
  for (const name of WRITES) {
    const write = fs[name] as (args: never) => Promise<unknown>;
    Object.assign(guarded, {
      [name]: (args: never) => {
        stillInVault(guard);
        return write(args);
      },
    });
  }
  return { ...fs, ...guarded };
}
