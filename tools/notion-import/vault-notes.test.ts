import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vaultNotes } from './vault-notes.ts';

const ID = 'c3000000000000000000000000000001';
const holding = (id: string) => `---\ntype: person\nnotion_id: '${id}'\n---\n`;

let vault: string;

beforeEach(async () => {
  vault = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-vault-notes-')));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe("the vault's notes", () => {
  it('finds the note of each Notion page by its notion_id, dashed or not, wherever it is', async () => {
    await mkdir(join(vault, 'Archive', 'People'), { recursive: true });
    await writeFile(join(vault, 'Archive', 'People', 'mara.md'), holding(ID));
    await writeFile(join(vault, 'tobias.md'), holding('c3000000-0000-0000-0000-000000000002'));
    const notes = await vaultNotes(vault);
    expect(notes.byNotionId).toEqual(
      new Map([
        [ID, ['Archive/People/mara.md']],
        ['c3000000000000000000000000000002', ['tobias.md']],
      ]),
    );
  });

  it("takes neither a sync conflict's copy, a hidden file, nor a note with no page for one", async () => {
    await writeFile(join(vault, 'mara.md'), holding(ID));
    await writeFile(join(vault, 'mara (conflict from Work Mac).md'), holding(ID));
    await mkdir(join(vault, '.trash'));
    await writeFile(join(vault, '.trash', 'mara.md'), holding(ID));
    await writeFile(join(vault, 'plain.md'), 'notion_id in the body is not one\n');
    await writeFile(join(vault, 'other.md'), holding('not an id'));
    const notes = await vaultNotes(vault);
    expect(notes.byNotionId).toEqual(new Map([[ID, ['mara.md']]]));
    expect([...notes.paths].sort()).toEqual([
      'mara (conflict from Work Mac).md',
      'mara.md',
      'other.md',
      'plain.md',
    ]);
  });
});
