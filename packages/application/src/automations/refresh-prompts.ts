import { BUILT_IN_PROMPTS, outdatedBuiltInPrompt, type VaultPath } from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * Brings each prompt note DFAI ships up to date when it still holds an
 * earlier version's words exactly (#226): untouched, so they are DFAI's, and
 * a rule asking them would ask what DFAI no longer means. A note the person
 * edited, or one that is not there, is left as it is. Written only over the
 * very version read, so an edit landing meanwhile is never overwritten.
 * Settles with the prompts it rewrote.
 */
export async function refreshBuiltInPrompts({
  fs,
}: {
  fs: Pick<VaultFsPort, 'readNotes' | 'writeTextFile'>;
}): Promise<VaultPath[]> {
  const held = await fs.readNotes(BUILT_IN_PROMPTS.map((prompt) => prompt.path));
  const refreshed: VaultPath[] = [];
  for (const note of held) {
    const prompt = outdatedBuiltInPrompt(note.path, note.text);
    if (prompt === null) continue;
    await fs.writeTextFile({
      path: prompt.path,
      contents: prompt.contents,
      expectedModified: note.modified,
    });
    refreshed.push(prompt.path);
  }
  return refreshed;
}
