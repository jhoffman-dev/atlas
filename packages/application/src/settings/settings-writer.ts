import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { readVaultSettings, saveVaultSettings } from './vault-settings.ts';

/** The one way into a vault's settings note, shared by every setting kept there. */
export interface SettingsWriter {
  /** Settles once the changes are in the file; rejects with why they are not. */
  save(changes: Readonly<Record<string, unknown>>): Promise<void>;
  /**
   * Changes worked out from the settings as they stand at the writer's turn:
   * read, changed and written with no other write between — for a setting a
   * change adds to, as a list two quick clicks each add one to.
   */
  update(
    change: (current: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

/**
 * Writes to the vault's settings note one at a time, merging what is saved
 * while a write is under way into the next one.
 *
 * Every setting shares one file. Two writes at once would each read the same
 * version, and the host refuses the second as stale — or, in a vault without
 * the file, both try to create it and the second fails. So there is one
 * writer per vault, each write reads the file afresh, and a setting saved
 * twice before its turn is written once, with the later value.
 */
export function createSettingsWriter({
  fs,
  markdown,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
}): SettingsWriter {
  let queue: Promise<void> = Promise.resolve();
  let waiting: { changes: Record<string, unknown>; written: Promise<void> } | null = null;

  return {
    save(changes) {
      if (waiting === null) {
        const next = { changes: {} as Record<string, unknown>, written: Promise.resolve() };
        next.written = queue.then(() => {
          // From here on, what is saved goes into the write after this one.
          if (waiting === next) waiting = null;
          return saveVaultSettings({ fs, markdown, changes: next.changes });
        });
        // Each caller hears of its own write's failure through `written`; the
        // queue only has to carry on to the next write.
        queue = next.written.catch(() => undefined);
        waiting = next;
      }
      Object.assign(waiting.changes, changes);
      return waiting.written;
    },
    update(change) {
      // Behind every write asked for so far; what is saved after goes after it.
      waiting = null;
      const written = queue.then(async () => {
        const current = await readVaultSettings({ fs, markdown });
        await saveVaultSettings({ fs, markdown, changes: change(current) });
      });
      // As for `save`: the caller hears of a failure through `written`.
      queue = written.catch(() => undefined);
      return written;
    },
  };
}
