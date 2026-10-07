import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { dailyNotePath, ensureDailyNote } from './daily-note.ts';

const TODAY = '2026-09-22';
const DAILY = { name: 'Daily', path: createVaultPath('.atlas/templates/Daily.md') };

function vault() {
  const created: { path: string; contents: string }[] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => ({ text: `from ${path}`, modified: 1 }),
    createNote: async ({ path, contents }) => {
      created.push({ path, contents });
    },
  });
  return { fs, created };
}

describe("today's note", () => {
  it('is named by the date, at the root of the vault', () => {
    expect(dailyNotePath(TODAY)).toBe('2026-09-22.md');
  });

  it('is found rather than made again when it is already there', async () => {
    const { fs, created } = vault();
    const found = await ensureDailyNote({
      fs,
      today: TODAY,
      notePaths: [createVaultPath('2026-09-22.md')],
      templates: [DAILY],
    });

    expect(found).toEqual({ path: '2026-09-22.md', created: false });
    expect(created).toEqual([]);
  });

  it('is made at the root from the Daily template', async () => {
    const { fs, created } = vault();
    const made = await ensureDailyNote({
      fs,
      today: TODAY,
      // A note of the same name in a folder is some other note.
      notePaths: [createVaultPath('Journal/2026-09-22.md')],
      templates: [DAILY],
    });

    expect(made).toEqual({ path: '2026-09-22.md', created: true });
    expect(created).toEqual([
      { path: '2026-09-22.md', contents: 'from .atlas/templates/Daily.md' },
    ]);
  });

  it('starts blank, named by its date alone, when the vault has no Daily template', async () => {
    const { fs, created } = vault();
    await ensureDailyNote({ fs, today: TODAY, notePaths: [] as VaultPath[], templates: [] });

    expect(created).toEqual([{ path: '2026-09-22.md', contents: '' }]);
  });

  it('is found, not numbered, when it appears between the listing and the create', async () => {
    const attempts: string[] = [];
    const fs = fakeVaultFs({
      listNotes: async () => [
        { name: '2026-09-22.md', path: createVaultPath('2026-09-22.md'), modified: 1, size: 1 },
      ],
      createNote: async ({ path }) => {
        attempts.push(path);
        throw new Error('a note with that name already exists');
      },
    });

    const found = await ensureDailyNote({ fs, today: TODAY, notePaths: [], templates: [] });

    expect(found).toEqual({ path: '2026-09-22.md', created: false });
    expect(attempts).toEqual(['2026-09-22.md']);
  });

  it("propagates the host's refusal when today's note is still not there", async () => {
    const fs = fakeVaultFs({
      createNote: async () => {
        throw new Error('permission denied');
      },
    });

    await expect(
      ensureDailyNote({ fs, today: TODAY, notePaths: [], templates: [] }),
    ).rejects.toThrow('permission denied');
  });
});
