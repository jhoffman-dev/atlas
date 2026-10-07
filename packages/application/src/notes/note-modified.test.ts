import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { noteModified } from './note-modified.ts';

const path = createVaultPath('today.md');

describe('noteModified', () => {
  it("reads the note's modification time as it stands", async () => {
    const fs = fakeVaultFs({
      readTextFile: async (read) => ({ text: '', modified: read === path ? 77 : 0 }),
    });

    expect(await noteModified({ fs, path })).toBe(77);
  });

  it('answers null for a note that cannot be read, rather than failing', async () => {
    const fs = fakeVaultFs({
      readTextFile: async () => {
        throw new Error('no such file');
      },
    });

    expect(await noteModified({ fs, path })).toBeNull();
  });
});
