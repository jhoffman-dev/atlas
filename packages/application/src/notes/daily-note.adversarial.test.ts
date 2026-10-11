import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { ensureDailyNote } from './daily-note.ts';

/**
 * #81 adversarial: today's note "found where it should be if it is already
 * there — a daily note imported from elsewhere included". The vault counts
 * `.markdown` and any-case `.MD` files as notes, and the Mac's disk folds case.
 */
const TODAY = '2026-09-22';
const markdown = fakeMarkdown();

describe("today's note already in the vault under another spelling", () => {
  it('is found, not made a second time, when it is `<date>.markdown` at the root', async () => {
    const imported = createVaultPath('2026-09-22.markdown');
    const created: string[] = [];
    const fs = fakeVaultFs({
      listNotes: async () => [
        { name: '2026-09-22.markdown', path: imported, modified: 1, size: 1 },
      ],
      createNote: async ({ path }) => {
        created.push(path);
      },
    });

    const found = await ensureDailyNote({
      fs,
      markdown,
      today: TODAY,
      notePaths: [imported],
      templates: [],
    });

    expect(created).toEqual([]);
    expect(found).toEqual({ path: imported, created: false });
  });

  it('is found, not refused, when it is `<date>.MD` and the disk will not make `<date>.md` beside it', async () => {
    const otherCase = createVaultPath('2026-09-22.MD');
    const fs = fakeVaultFs({
      listNotes: async () => [{ name: '2026-09-22.MD', path: otherCase, modified: 1, size: 1 }],
      // APFS folds case: `2026-09-22.md` is the file that is already there.
      createNote: async () => {
        throw new Error('a note with that name already exists');
      },
    });

    await expect(
      ensureDailyNote({ fs, markdown, today: TODAY, notePaths: [otherCase], templates: [] }),
    ).resolves.toEqual({ path: otherCase, created: false });
  });
});
