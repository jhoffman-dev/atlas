import { describe, expect, it } from 'vitest';
import { AFTER_A_MEETING_PROMPT, builtInPromptAt, MEETING_EXTRACTION_PROMPT } from '@atlas/domain';
import {
  EARLIER_AFTER_A_MEETING,
  EARLIER_MEETING_EXTRACTION,
} from '../../../domain/src/automations/built-in-prompts.earlier.fixture.ts';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { refreshBuiltInPrompts } from './refresh-prompts.ts';

/** #226: a prompt DFAI shipped, never edited, is brought up to date; anything else is the person's. */

function vaultOf(notes: Record<string, string>) {
  const files = new Map(Object.entries(notes));
  const writes: { path: string; expectedModified: number | null }[] = [];
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 7, size: text.length }];
      }),
    writeTextFile: async ({ path, contents, expectedModified }) => {
      writes.push({ path, expectedModified });
      files.set(path, contents);
      return 8;
    },
  });
  return { fs, files, writes };
}

describe('refreshBuiltInPrompts', () => {
  it('writes the words DFAI ships now over an untouched earlier version, over the very version read', async () => {
    const vault = vaultOf({
      [AFTER_A_MEETING_PROMPT]: EARLIER_AFTER_A_MEETING,
      [MEETING_EXTRACTION_PROMPT]: EARLIER_MEETING_EXTRACTION,
    });

    const refreshed = await refreshBuiltInPrompts({ fs: vault.fs });

    expect(refreshed.sort()).toEqual([AFTER_A_MEETING_PROMPT, MEETING_EXTRACTION_PROMPT].sort());
    expect(vault.files.get(AFTER_A_MEETING_PROMPT)).toBe(
      builtInPromptAt(AFTER_A_MEETING_PROMPT)!.contents,
    );
    expect(vault.writes.every(({ expectedModified }) => expectedModified === 7)).toBe(true);
  });

  it('leaves an edited prompt, a current one and a missing one as they are', async () => {
    const edited = `${EARLIER_AFTER_A_MEETING}\nAlso list Mara Quill’s items.\n`;
    const vault = vaultOf({
      [AFTER_A_MEETING_PROMPT]: edited,
      [MEETING_EXTRACTION_PROMPT]: builtInPromptAt(MEETING_EXTRACTION_PROMPT)!.contents,
    });

    expect(await refreshBuiltInPrompts({ fs: vault.fs })).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(vault.files.get(AFTER_A_MEETING_PROMPT)).toBe(edited);
    expect(await refreshBuiltInPrompts({ fs: vaultOf({}).fs })).toEqual([]);
  });

  it('raises a write the host refuses, having written nothing it was not sure of', async () => {
    const vault = vaultOf({ [AFTER_A_MEETING_PROMPT]: EARLIER_AFTER_A_MEETING });
    vault.fs.writeTextFile = async () => {
      throw new Error('The note changed since it was read.');
    };

    await expect(refreshBuiltInPrompts({ fs: vault.fs })).rejects.toThrow('changed since');
    expect(vault.files.get(AFTER_A_MEETING_PROMPT)).toBe(EARLIER_AFTER_A_MEETING);
  });
});
