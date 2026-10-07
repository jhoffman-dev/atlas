/**
 * Adversarial pass on renaming tags (P20-05): a vault larger than one page of
 * results, a rename into the tag's own child, children that collide, and a
 * rename that only evens out spellings. Each test names the invariant it holds.
 */
import { describe, expect, it, vi } from 'vitest';
import { TAG_PAGE_SIZE } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { tagIndexQuery } from '../testing/tag-index.ts';
import { loadTaggedNotes } from './load-tags.ts';
import { renameTag, TagRenameError, tagRenamePlan } from './rename-tag.ts';

const markdown = fakeMarkdown();

function vault(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.map((path) => ({ path, text: disk.get(path) ?? '', modified: 1, size: 1 })),
    readTextFile: async (path) => ({ text: disk.get(path) ?? '', modified: 1 }),
    writeTextFile: vi.fn(async ({ path, contents }: { path: string; contents: string }) => {
      disk.set(path, contents);
      return 2;
    }),
  });
  return { fs, disk, index: fakeIndexPort({ query: tagIndexQuery({ files, markdown }) }) };
}

const closed = () => ({
  state: () => 'closed' as const,
  flush: vi.fn(async () => {}),
  reload: vi.fn(),
});

describe('a tag used in more notes than one page of results holds', () => {
  const MANY = TAG_PAGE_SIZE + 1;
  const files = Object.fromEntries(
    Array.from({ length: MANY }, (_, at) => [`n${String(at).padStart(5, '0')}.md`, '#idea\n']),
  );

  it('lists every note using it', async () => {
    const { index } = vault(files);
    expect(await loadTaggedNotes({ index, key: 'idea' })).toHaveLength(MANY);
  });

  it('plans a rename across every note using it, so none keeps the old name', async () => {
    const { fs, index } = vault(files);
    const plan = await tagRenamePlan({ index, fs, markdown, rename: { from: 'idea', to: 'y' } });
    expect(plan.notes).toHaveLength(MANY);
  });
});

describe('renaming a tag into its own child', () => {
  it('never moves the uses that already had the new name', async () => {
    const { fs, disk, index } = vault({ 'a.md': '#a and #a/b\n' });
    const rename = { from: 'a', to: 'a/b' };
    await expect(tagRenamePlan({ index, fs, markdown, rename })).rejects.toThrow(/inside itself/);
    const outcome = await tagRenamePlan({ index, fs, markdown, rename }).then(
      async (plan) => {
        await renameTag({ fs, markdown, openNotes: closed(), plan });
        return disk.get('a.md');
      },
      (error: unknown) => (error instanceof TagRenameError ? 'refused' : error),
    );
    // Either refused, or merged: `#a` joins `#a/b`, which stays where it was.
    expect(['refused', '#a/b and #a/b\n']).toContain(outcome);
  });
});

describe('renaming a parent whose children collide with the new name’s', () => {
  it('says the rename is a merge before anything is written', async () => {
    const { fs, index } = vault({ 'a.md': '#a/x\n', 'b.md': '#b/x\n' });
    const plan = await tagRenamePlan({ index, fs, markdown, rename: { from: 'a', to: 'b' } });
    // `#a/x` becomes `#b/x`, a tag already in use: the preview must say so.
    expect(plan.mergesInto).not.toBeNull();
  });

  it('names the new name itself, in use as the parent of the tag the nested one joins', async () => {
    const { fs, index } = vault({ 'a.md': '#a/x\n', 'b.md': '#B/x\n' });
    const plan = await tagRenamePlan({ index, fs, markdown, rename: { from: 'a', to: 'b' } });
    // `#B/x` makes `#B` a tag too: renaming `#b` back would carry `#B/x` with it.
    expect(plan.mergesInto).toBe('B');
  });

  it('names the renamed tag itself first when it is the one already in use', async () => {
    const { fs, index } = vault({ 'a.md': '#a #a/x\n', 'b.md': '#b #b/x\n' });
    const plan = await tagRenamePlan({ index, fs, markdown, rename: { from: 'a', to: 'B' } });
    expect(plan.mergesInto).toBe('b');
  });

  it('is no merge when nothing already has the new names', async () => {
    const { fs, index } = vault({ 'a.md': '#a/x\n', 'b.md': '#c/y\n' });
    const plan = await tagRenamePlan({ index, fs, markdown, rename: { from: 'a', to: 'b' } });
    expect(plan.mergesInto).toBeNull();
  });
});

describe('a tag written with different cases', () => {
  it('can be renamed to the spelling it is shown with, so every use matches it', async () => {
    // Shown as `Idea`, its first use by path; `b.md` writes it `idea`.
    const { fs, index } = vault({ 'a.md': '#Idea\n', 'b.md': '#idea\n' });
    const plan = await tagRenamePlan({
      index,
      fs,
      markdown,
      rename: { from: 'Idea', to: 'Idea' },
    });
    expect(plan.notes.map((note) => note.path)).toEqual(['b.md']);
  });
});
