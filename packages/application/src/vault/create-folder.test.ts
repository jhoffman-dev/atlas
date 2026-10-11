import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultEntry } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { VaultAccessError } from './ports.ts';
import { ensureFolder } from './create-folder.ts';

/**
 * A disk where another write makes `taken` between this one's listing and its
 * create, as two requests at once do; `taken` holds what is there by then.
 */
function racedFs(taken: VaultEntry) {
  let listed = 0;
  return fakeVaultFs({
    listDirectory: async () => (listed++ === 0 ? [] : [taken]),
    createFolder: async () => {
      throw new VaultAccessError('that name is taken');
    },
  });
}

describe('ensureFolder', () => {
  it('uses the folder another write made between its listing and its create, as that write spelt it', async () => {
    const fs = racedFs({ kind: 'directory', name: 'inbox', path: createVaultPath('inbox') });
    await expect(ensureFolder({ fs, folder: createVaultPath('Inbox') })).resolves.toBe('inbox');
  });

  it('passes the refusal on when what is there is not a folder', async () => {
    const fs = racedFs({ kind: 'file', name: 'Inbox', path: createVaultPath('Inbox') });
    await expect(ensureFolder({ fs, folder: createVaultPath('Inbox') })).rejects.toThrow(
      'that name is taken',
    );
  });
});
